use axum::extract::{Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use utopia_core::models::Role;
use utopia_llm::{ChatMessage, LlmClient};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::ApiResult;
use crate::state::AppState;

#[derive(Deserialize)]
pub struct CreateProviderReq {
    pub provider_id: String,
    pub name: String,
    pub provider_type: Option<String>,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Deserialize)]
pub struct UpdateProviderReq {
    pub name: Option<String>,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct AddModelReq {
    pub model: String,
    pub kind: String,
    pub context_window: Option<i32>,
}

#[derive(Deserialize)]
pub struct UpdateModelReq {
    pub enabled: Option<bool>,
}

#[derive(Deserialize)]
pub struct TestReq {
    pub model: String,
    pub kind: String,
}

#[derive(Deserialize)]
pub struct ActivateReq {
    pub kind: String,
}

async fn require_admin(state: &AppState, user: &AuthUser, workspace_id: Uuid) -> ApiResult<()> {
    utopia_store::workspaces::require_role(&state.pool, user.0.id, workspace_id, Role::Admin).await?;
    Ok(())
}

fn masked_provider(row: &utopia_store::model_providers::ProviderRow) -> Value {
    json!({
        "id": row.id,
        "provider_id": row.provider_id,
        "name": row.name,
        "provider_type": row.provider_type,
        "base_url": row.base_url,
        "has_api_key": row.api_key.as_deref().is_some_and(|v| !v.is_empty()),
        "enabled": row.enabled,
        "created_at": row.created_at,
        "updated_at": row.updated_at,
    })
}

pub async fn list(
    State(state): State<AppState>,
    user: AuthUser,
    Path(workspace_id): Path<Uuid>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let providers = utopia_store::model_providers::list(&state.pool, workspace_id).await?;
    let active = utopia_store::settings::get(&state.pool, workspace_id).await?;
    let mut result = Vec::with_capacity(providers.len());
    for provider in providers {
        let models = utopia_store::model_providers::models(&state.pool, workspace_id, provider.id).await?;
        let mut view = masked_provider(&provider);
        view["models"] = json!(models);
        view["active_chat_model"] = json!(active.as_ref().and_then(|s| {
            (s.chat_base_url.as_deref() == Some(provider.base_url.as_str()))
                .then(|| s.chat_model.clone())
                .flatten()
        }));
        view["active_embedding_model"] = json!(active.as_ref().and_then(|s| {
            (s.embed_base_url.as_deref() == Some(provider.base_url.as_str()))
                .then(|| s.embed_model.clone())
                .flatten()
        }));
        result.push(view);
    }
    Ok(Json(json!({ "providers": result })))
}

pub async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Path(workspace_id): Path<Uuid>,
    Json(req): Json<CreateProviderReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let provider_type = req.provider_type.as_deref().unwrap_or("openai_compatible");
    let id = utopia_store::model_providers::create(
        &state.pool,
        workspace_id,
        &req.provider_id,
        &req.name,
        provider_type,
        &req.base_url,
        req.api_key.as_deref().filter(|v| !v.trim().is_empty()),
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

pub async fn update(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<UpdateProviderReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    utopia_store::model_providers::update(
        &state.pool,
        workspace_id,
        provider_id,
        req.name.as_deref(),
        req.base_url.as_deref(),
        req.api_key.as_deref().filter(|v| !v.trim().is_empty()),
        req.enabled,
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    utopia_store::model_providers::delete(&state.pool, workspace_id, provider_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn add_model(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<AddModelReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let id = utopia_store::model_providers::add_model(
        &state.pool,
        workspace_id,
        provider_id,
        &req.model,
        &req.kind,
        req.context_window,
    )
    .await?;
    Ok(Json(json!({ "id": id })))
}

pub async fn update_model(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id, model_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(req): Json<UpdateModelReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    utopia_store::model_providers::update_model(
        &state.pool,
        workspace_id,
        provider_id,
        model_id,
        req.enabled,
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn delete_model(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id, model_id)): Path<(Uuid, Uuid, Uuid)>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    utopia_store::model_providers::delete_model(
        &state.pool,
        workspace_id,
        provider_id,
        model_id,
    )
    .await?;
    Ok(Json(json!({ "ok": true })))
}

pub async fn discover(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let provider = utopia_store::model_providers::get(&state.pool, workspace_id, provider_id).await?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|error| utopia_core::AppError::Other(error.into()))?;
    let mut request = client.get(format!("{}/models", provider.base_url.trim_end_matches('/')));
    if let Some(key) = provider.api_key.as_deref().filter(|v| !v.is_empty()) {
        request = request.bearer_auth(key);
    }
    let response = request
        .send()
        .await
        .map_err(|error| utopia_core::AppError::Other(error.into()))?;
    let status = response.status();
    let body: Value = response.json().await.unwrap_or_else(|_| json!({}));
    if !status.is_success() {
        return Ok(Json(json!({ "ok": false, "error": format!("HTTP {status}"), "body": body })));
    }
    let models = body
        .get("data")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.get("id").and_then(Value::as_str))
                .map(|id| json!({ "id": id }))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(Json(json!({ "ok": true, "models": models })))
}

pub async fn test(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id)): Path<(Uuid, Uuid)>,
    Json(req): Json<TestReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let provider = utopia_store::model_providers::get(&state.pool, workspace_id, provider_id).await?;
    let key = provider.api_key.as_deref().filter(|v| !v.is_empty());
    let client = LlmClient::new(&provider.base_url, key, req.model.trim());
    let result = match req.kind.as_str() {
        "chat" => {
            let message = [ChatMessage {
                role: "user".into(),
                content: "Reply with exactly one word: OK".into(),
            }];
            client.chat(&message).await.map(|reply| json!({ "reply": reply }))
        }
        "embedding" => client
            .embed(&["connectivity test".to_string()])
            .await
            .map(|vectors| json!({ "dim": vectors.first().map(Vec::len).unwrap_or(0) })),
        _ => Err(anyhow::anyhow!("This model kind cannot be tested here")),
    };
    Ok(Json(match result {
        Ok(detail) => json!({ "ok": true, "detail": detail }),
        Err(error) => json!({ "ok": false, "error": format!("{error:#}") }),
    }))
}

pub async fn activate(
    State(state): State<AppState>,
    user: AuthUser,
    Path((workspace_id, provider_id, model_id)): Path<(Uuid, Uuid, Uuid)>,
    Json(req): Json<ActivateReq>,
) -> ApiResult<Json<Value>> {
    require_admin(&state, &user, workspace_id).await?;
    let provider = utopia_store::model_providers::get(&state.pool, workspace_id, provider_id).await?;
    let models = utopia_store::model_providers::models(&state.pool, workspace_id, provider_id).await?;
    let model = models.into_iter().find(|m| m.id == model_id).ok_or(utopia_core::AppError::NotFound)?;
    let settings = utopia_store::settings::get(&state.pool, workspace_id).await?;
    let key = provider.api_key.as_deref().unwrap_or("");
    match req.kind.as_str() {
        "chat" if model.kind == "chat" => {
            utopia_store::settings::activate_chat(
                &state.pool,
                workspace_id,
                Some(&provider.base_url),
                Some(key),
                Some(&model.model),
                settings.as_ref().and_then(|s| s.embed_base_url.as_deref()),
                settings.as_ref().and_then(|s| s.embed_api_key.as_deref()),
                settings.as_ref().and_then(|s| s.embed_model.as_deref()),
                settings.as_ref().and_then(|s| s.embed_dim),
            )
            .await?;
        }
        "embedding" if model.kind == "embedding" => {
            utopia_store::settings::activate_embed(
                &state.pool,
                workspace_id,
                settings.as_ref().and_then(|s| s.chat_base_url.as_deref()),
                settings.as_ref().and_then(|s| s.chat_api_key.as_deref()),
                settings.as_ref().and_then(|s| s.chat_model.as_deref()),
                Some(&provider.base_url),
                Some(key),
                Some(&model.model),
                settings.as_ref().and_then(|s| s.embed_dim),
            )
            .await?;
        }
        _ => return Ok(Json(json!({ "ok": false, "error": "Model kind does not match activation kind" }))),
    }
    Ok(Json(json!({ "ok": true })))
}
