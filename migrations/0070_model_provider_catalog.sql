-- 模型供应商目录（0070）。
--
-- llm_settings 仍然保存当前工作区实际使用的 chat/embed/reader 配置，
-- 本目录只负责管理可选供应商与模型。这样升级不会改变已有知识库的运行配置，
-- 只有管理员明确把某个模型设为对话模型或向量模型时，才写回 llm_settings。
CREATE TABLE llm_providers (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    provider_id TEXT NOT NULL,
    name TEXT NOT NULL,
    provider_type TEXT NOT NULL DEFAULT 'openai_compatible'
        CHECK (provider_type IN ('openai_compatible')),
    base_url TEXT NOT NULL,
    api_key TEXT,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, provider_id)
);

CREATE TABLE llm_provider_models (
    id UUID PRIMARY KEY,
    provider_id UUID NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('chat', 'embedding', 'rerank')),
    context_window INTEGER,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_id, model, kind)
);

CREATE INDEX llm_providers_workspace_idx ON llm_providers(workspace_id, name);
CREATE INDEX llm_provider_models_provider_idx ON llm_provider_models(provider_id, kind, model);

-- 兼容旧版设置：把已经配置过的 chat/embed 端点变成目录项，避免升级后管理页看起来是空的。
-- api_key 已经是旧表中的封印值，原样复制仍由应用层统一开封/封印。
WITH legacy AS (
    SELECT workspace_id, chat_base_url AS base_url, chat_api_key AS api_key
      FROM llm_settings
     WHERE chat_base_url IS NOT NULL
    UNION ALL
    SELECT workspace_id, embed_base_url AS base_url, embed_api_key AS api_key
      FROM llm_settings
     WHERE embed_base_url IS NOT NULL
), grouped AS (
    SELECT workspace_id, base_url, MIN(api_key) AS api_key
      FROM legacy
     GROUP BY workspace_id, base_url
)
INSERT INTO llm_providers
    (id, workspace_id, provider_id, name, provider_type, base_url, api_key)
SELECT gen_random_uuid(), workspace_id,
       'legacy-' || substr(md5(base_url), 1, 16),
       '已配置供应商', 'openai_compatible', base_url, api_key
  FROM grouped
ON CONFLICT (workspace_id, provider_id) DO NOTHING;

INSERT INTO llm_provider_models (id, provider_id, model, kind)
SELECT gen_random_uuid(), p.id, s.model, s.kind
  FROM (
      SELECT workspace_id, chat_base_url AS base_url, chat_model AS model, 'chat' AS kind
        FROM llm_settings
       WHERE chat_base_url IS NOT NULL AND chat_model IS NOT NULL
      UNION ALL
      SELECT workspace_id, embed_base_url AS base_url, embed_model AS model, 'embedding' AS kind
        FROM llm_settings
       WHERE embed_base_url IS NOT NULL AND embed_model IS NOT NULL
  ) AS s
  JOIN llm_providers p
    ON p.workspace_id = s.workspace_id
   AND p.base_url = s.base_url
ON CONFLICT (provider_id, model, kind) DO NOTHING;
