//! 工作区级模型供应商目录。
//!
//! 目录与 `llm_settings` 分开：前者是管理员维护的候选项，后者是运行时实际选中的
//! chat/embed/reader 配置。API key 在这里入库即封印，列表与前端永远只拿到布尔状态。

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use utopia_core::{secrets, AppError, AppResult};
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ProviderRow {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub provider_id: String,
    pub name: String,
    pub provider_type: String,
    pub base_url: String,
    #[serde(skip_serializing)]
    pub api_key: Option<String>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct ModelRow {
    pub id: Uuid,
    pub provider_id: Uuid,
    pub model: String,
    pub kind: String,
    pub context_window: Option<i32>,
    pub enabled: bool,
    pub created_at: DateTime<Utc>,
}

pub async fn list(pool: &PgPool, workspace_id: Uuid) -> AppResult<Vec<ProviderRow>> {
    Ok(sqlx::query_as(
        "SELECT id, workspace_id, provider_id, name, provider_type, base_url, api_key,
                enabled, created_at, updated_at
           FROM llm_providers WHERE workspace_id = $1 ORDER BY enabled DESC, name",
    )
    .bind(workspace_id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .map(open_provider)
    .collect::<AppResult<Vec<_>>>()?)
}

pub async fn get(pool: &PgPool, workspace_id: Uuid, id: Uuid) -> AppResult<ProviderRow> {
    let row: Option<ProviderRow> = sqlx::query_as(
        "SELECT id, workspace_id, provider_id, name, provider_type, base_url, api_key,
                enabled, created_at, updated_at
           FROM llm_providers WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(id)
    .fetch_optional(pool)
    .await?;
    row.map(open_provider).transpose()?.ok_or(AppError::NotFound)
}

fn open_provider(mut row: ProviderRow) -> AppResult<ProviderRow> {
    row.api_key = secrets::open_opt(row.api_key.as_deref()).map_err(AppError::Other)?;
    Ok(row)
}

pub async fn create(
    pool: &PgPool,
    workspace_id: Uuid,
    provider_id: &str,
    name: &str,
    provider_type: &str,
    base_url: &str,
    api_key: Option<&str>,
) -> AppResult<Uuid> {
    let provider_id = provider_id.trim();
    let name = name.trim();
    let base_url = base_url.trim().trim_end_matches('/');
    if provider_id.is_empty() || name.is_empty() || base_url.is_empty() {
        return Err(AppError::invalid(
            "provider_fields_required",
            "Provider id, name and base URL are required",
        ));
    }
    if provider_type != "openai_compatible" {
        return Err(AppError::invalid(
            "unsupported_provider_type",
            "Only OpenAI-compatible providers are supported",
        ));
    }
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO llm_providers
            (id, workspace_id, provider_id, name, provider_type, base_url, api_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(id)
    .bind(workspace_id)
    .bind(provider_id)
    .bind(name)
    .bind(provider_type)
    .bind(base_url)
    .bind(secrets::seal_opt(api_key))
    .execute(pool)
    .await
    .map_err(|e| {
        if let sqlx::Error::Database(db) = &e {
            if db.constraint() == Some("llm_providers_workspace_id_provider_id_key") {
                return AppError::invalid("provider_id_exists", "Provider id already exists");
            }
        }
        AppError::from(e)
    })?;
    Ok(id)
}

pub async fn update(
    pool: &PgPool,
    workspace_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    base_url: Option<&str>,
    api_key: Option<&str>,
    enabled: Option<bool>,
) -> AppResult<()> {
    let provider = get(pool, workspace_id, id).await?;
    let name = name.map(str::trim).filter(|v| !v.is_empty()).unwrap_or(&provider.name);
    let base_url = base_url
        .map(|v| v.trim().trim_end_matches('/'))
        .filter(|v| !v.is_empty())
        .unwrap_or(&provider.base_url);
    let sealed = api_key.and_then(|v| (!v.trim().is_empty()).then(|| secrets::seal(v.trim())));
    sqlx::query(
        "UPDATE llm_providers
            SET name = $3, base_url = $4,
                api_key = COALESCE($5, api_key),
                enabled = COALESCE($6, enabled), updated_at = now()
          WHERE workspace_id = $1 AND id = $2",
    )
    .bind(workspace_id)
    .bind(id)
    .bind(name)
    .bind(base_url)
    .bind(sealed)
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn delete(pool: &PgPool, workspace_id: Uuid, id: Uuid) -> AppResult<()> {
    let result = sqlx::query("DELETE FROM llm_providers WHERE workspace_id = $1 AND id = $2")
        .bind(workspace_id)
        .bind(id)
        .execute(pool)
        .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub async fn models(pool: &PgPool, workspace_id: Uuid, provider_id: Uuid) -> AppResult<Vec<ModelRow>> {
    let _ = get(pool, workspace_id, provider_id).await?;
    Ok(sqlx::query_as(
        "SELECT id, provider_id, model, kind, context_window, enabled, created_at
           FROM llm_provider_models WHERE provider_id = $1 ORDER BY kind, model",
    )
    .bind(provider_id)
    .fetch_all(pool)
    .await?)
}

pub async fn add_model(
    pool: &PgPool,
    workspace_id: Uuid,
    provider_id: Uuid,
    model: &str,
    kind: &str,
    context_window: Option<i32>,
) -> AppResult<Uuid> {
    let _ = get(pool, workspace_id, provider_id).await?;
    let model = model.trim();
    if model.is_empty() || !matches!(kind, "chat" | "embedding" | "rerank") {
        return Err(AppError::invalid("model_fields_invalid", "Model and kind are required"));
    }
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO llm_provider_models (id, provider_id, model, kind, context_window)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (provider_id, model, kind) DO UPDATE SET
             context_window = COALESCE(EXCLUDED.context_window, llm_provider_models.context_window)",
    )
    .bind(id)
    .bind(provider_id)
    .bind(model)
    .bind(kind)
    .bind(context_window)
    .execute(pool)
    .await?;
    let row: (Uuid,) = sqlx::query_as(
        "SELECT id FROM llm_provider_models WHERE provider_id = $1 AND model = $2 AND kind = $3",
    )
    .bind(provider_id)
    .bind(model)
    .bind(kind)
    .fetch_one(pool)
    .await?;
    Ok(row.0)
}

pub async fn update_model(
    pool: &PgPool,
    workspace_id: Uuid,
    provider_id: Uuid,
    model_id: Uuid,
    enabled: Option<bool>,
) -> AppResult<()> {
    let _ = get(pool, workspace_id, provider_id).await?;
    let result = sqlx::query(
        "UPDATE llm_provider_models SET enabled = COALESCE($4, enabled)
           WHERE id = $1 AND provider_id = $2 AND provider_id IN
             (SELECT id FROM llm_providers WHERE workspace_id = $3)",
    )
    .bind(model_id)
    .bind(provider_id)
    .bind(workspace_id)
    .bind(enabled)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

pub async fn delete_model(
    pool: &PgPool,
    workspace_id: Uuid,
    provider_id: Uuid,
    model_id: Uuid,
) -> AppResult<()> {
    let _ = get(pool, workspace_id, provider_id).await?;
    let result = sqlx::query(
        "DELETE FROM llm_provider_models WHERE id = $1 AND provider_id = $2 AND provider_id IN
            (SELECT id FROM llm_providers WHERE workspace_id = $3)",
    )
    .bind(model_id)
    .bind(provider_id)
    .bind(workspace_id)
    .execute(pool)
    .await?;
    if result.rows_affected() == 0 {
        return Err(AppError::NotFound);
    }
    Ok(())
}

