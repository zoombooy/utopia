import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CircleAlert,
  Pencil,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import {
  api,
  type ModelProviderKind,
  type ModelProviderModel,
  type ModelProviderView,
} from "../api";
import { S } from "../i18n";
import { toast } from "../toast";
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  Field,
  FormDialog,
  IconButton,
  Input,
  Segmented,
} from "../ui";

type ProviderForm = {
  provider_id: string;
  name: string;
  base_url: string;
  api_key: string;
};

const EMPTY_PROVIDER: ProviderForm = {
  provider_id: "",
  name: "",
  base_url: "",
  api_key: "",
};

function kindOptions(): { value: ModelProviderKind; label: string }[] {
  return [
    { value: "chat", label: S.settings.providers.chat },
    { value: "embedding", label: S.settings.providers.embedding },
    { value: "rerank", label: S.settings.providers.rerank },
  ];
}

function modelKindLabel(kind: ModelProviderKind) {
  return kindOptions().find((item) => item.value === kind)?.label ?? kind;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function providerCapabilities(provider: ModelProviderView) {
  const kinds = new Set(provider.models.filter((model) => model.enabled).map((model) => model.kind));
  return [
    kinds.has("chat") ? S.settings.providers.chat : null,
    kinds.has("embedding") ? S.settings.providers.embedding : null,
    kinds.has("rerank") ? S.settings.providers.rerank : null,
  ].filter(Boolean).join(", ");
}

function ProviderEditor({
  workspaceId,
  provider,
  onClose,
  onSaved,
}: {
  workspaceId: string;
  provider: ModelProviderView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<ProviderForm>(EMPTY_PROVIDER);
  const isNew = !provider;

  useEffect(() => {
    setForm(
      provider
        ? {
            provider_id: provider.provider_id,
            name: provider.name,
            base_url: provider.base_url,
            api_key: "",
          }
        : EMPTY_PROVIDER,
    );
  }, [provider]);

  const save = useMutation({
    mutationFn: async () => {
      if (isNew) {
        await api.createModelProvider(workspaceId, form);
      } else {
        await api.updateModelProvider(workspaceId, provider.id, {
          name: form.name,
          base_url: form.base_url,
          ...(form.api_key ? { api_key: form.api_key } : {}),
        });
      }
    },
    onSuccess: () => {
      toast.success(isNew ? S.settings.providers.providerCreated : S.settings.providers.providerSaved);
      onSaved();
      onClose();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const valid = Boolean(form.provider_id.trim() && form.name.trim() && form.base_url.trim());
  const set = (key: keyof ProviderForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  return (
    <FormDialog
      title={isNew ? S.settings.providers.addTitle : S.settings.providers.editTitle}
      description={S.settings.providers.hint}
      closeLabel={S.ui.close}
      width="md"
      saveLabel={S.settings.providers.save}
      cancelLabel={S.settings.providers.cancel}
      canSave={valid}
      busy={save.isPending}
      onSave={() => save.mutate()}
      onCancel={onClose}
    >
      <Field label={S.settings.providers.providerId} hint={isNew ? "例如 siliconflow-cn、local-grm" : undefined}>
        <Input
          className="w-full"
          value={form.provider_id}
          disabled={!isNew}
          onChange={set("provider_id")}
          placeholder="local-grm"
        />
      </Field>
      <Field label={S.settings.providers.displayName}>
        <Input className="w-full" value={form.name} onChange={set("name")} placeholder="本地 GRM" />
      </Field>
      <Field label={S.settings.providers.providerType}>
        <div className="rounded-control border border-input bg-surface px-3 py-2 text-body text-ink">
          {S.settings.providers.openaiCompatible}
        </div>
      </Field>
      <Field label={S.settings.providers.baseUrl} hint="可填写到 /v1，系统会按 OpenAI 兼容接口访问。">
        <Input
          className="w-full"
          value={form.base_url}
          onChange={set("base_url")}
          placeholder="http://127.0.0.1:8000/v1"
        />
      </Field>
      <Field
        label={S.settings.providers.apiKey}
        hint={provider?.has_api_key ? S.settings.providers.keyConfigured : undefined}
      >
        <Input
          className="w-full"
          type="password"
          value={form.api_key}
          onChange={set("api_key")}
          placeholder={provider?.has_api_key ? "留空保持不变" : "sk-…"}
        />
      </Field>
    </FormDialog>
  );
}

function ProviderModels({
  workspaceId,
  provider,
  onClose,
  onRefresh,
}: {
  workspaceId: string;
  provider: ModelProviderView;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [kind, setKind] = useState<ModelProviderKind>("chat");
  const [model, setModel] = useState("");
  const [context, setContext] = useState("");
  const [remoteModels, setRemoteModels] = useState<string[]>([]);
  const [testing, setTesting] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidate = () => {
    onRefresh();
    void queryClient.invalidateQueries({ queryKey: ["model-providers", workspaceId] });
  };

  const discover = useMutation({
    mutationFn: () => api.discoverModelProvider(workspaceId, provider.id),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(result.error || S.settings.providers.discoverFailed);
        return;
      }
      setRemoteModels((result.models ?? []).map((item) => item.id));
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const add = useMutation({
    mutationFn: (payload: { model: string; kind: ModelProviderKind }) =>
      api.addProviderModel(workspaceId, provider.id, {
        ...payload,
        ...(context.trim() ? { context_window: Number(context) } : {}),
      }),
    onSuccess: () => {
      setModel("");
      setContext("");
      setRemoteModels((current) => current.filter((item) => item !== model));
      toast.success(S.settings.providers.modelAdded);
      invalidate();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const update = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      api.updateProviderModel(workspaceId, provider.id, id, { enabled }),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorText(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteProviderModel(workspaceId, provider.id, id),
    onSuccess: () => {
      toast.success(S.settings.providers.modelDeleted);
      invalidate();
    },
    onError: (error) => toast.error(errorText(error)),
  });

  const activate = useMutation({
    mutationFn: ({ id, modelKind }: { id: string; modelKind: "chat" | "embedding" }) =>
      api.activateProviderModel(workspaceId, provider.id, id, modelKind),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorText(error)),
  });

  const test = async (item: ModelProviderModel) => {
    setTesting(item.id);
    try {
      const result = await api.testModelProvider(workspaceId, provider.id, {
        model: item.model,
        kind: item.kind,
      });
      if (result.ok) {
        const detail = typeof result.detail === "string" ? result.detail : "";
        toast.success(S.settings.providers.testOk(detail));
      } else {
        toast.error(S.settings.providers.testFail(result.error || "unknown error"));
      }
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setTesting(null);
    }
  };

  const existing = useMemo(
    () => new Set(provider.models.map((item) => `${item.kind}:${item.model}`)),
    [provider.models],
  );
  const availableRemote = remoteModels.filter((item) => !existing.has(`${kind}:${item}`));
  const options = kindOptions();

  const addModel = (modelName: string) => {
    if (!modelName.trim()) return;
    add.mutate({ model: modelName.trim(), kind });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => !open && onClose()}
      title={`${S.settings.providers.manageModels}：${provider.name}`}
      description={`${provider.base_url} · ${provider.provider_id}`}
      closeLabel={S.ui.close}
      width="lg"
      footer={
        <Button variant="secondary" size="sm" onClick={onClose}>
          {S.settings.providers.cancel}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-line bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-small font-medium text-ink">{S.settings.providers.discover}</p>
            <p className="mt-1 text-fine text-ink-2">读取供应商的 /models，仅展示可手动加入的模型。</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            icon={<RefreshCw size={14} />}
            busy={discover.isPending}
            onClick={() => discover.mutate()}
          >
            {discover.isPending ? S.settings.providers.discovering : S.settings.providers.discover}
          </Button>
        </div>

        {availableRemote.length > 0 && (
          <div>
            <p className="mb-2 text-small font-medium text-ink">{S.settings.providers.discovered}</p>
            <div className="flex flex-wrap gap-2">
              {availableRemote.map((item) => (
                <Button key={item} variant="secondary" size="sm" onClick={() => addModel(item)}>
                  <Plus size={13} /> {item}
                </Button>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-panel border border-line bg-surface p-4">
          <p className="mb-3 text-small font-medium text-ink">{S.settings.providers.addManual}</p>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input
              className="w-full"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder={S.settings.providers.model}
            />
            <Segmented value={kind} options={options} onChange={setKind} size="sm" />
          </div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="min-w-48 flex-1">
              <label className="mb-1 block text-fine text-ink-2">{S.settings.providers.context}</label>
              <Input
                className="w-full"
                type="number"
                min={1}
                value={context}
                onChange={(event) => setContext(event.target.value)}
                placeholder="32768"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              disabled={!model.trim() || add.isPending}
              busy={add.isPending}
              onClick={() => addModel(model)}
            >
              {S.settings.providers.addModel}
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-small font-medium text-ink">{S.settings.providers.model}</p>
            <span className="text-fine text-ink-2">{provider.models.length}</span>
          </div>
          {provider.models.length === 0 ? (
            <p className="rounded-panel border border-dashed border-line p-4 text-small text-ink-2">
              {S.settings.providers.emptyModels}
            </p>
          ) : (
            provider.models.map((item) => {
              const active = item.kind === "chat"
                ? provider.active_chat_model === item.model
                : item.kind === "embedding"
                  ? provider.active_embedding_model === item.model
                  : false;
              return (
                <div key={item.id} className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-background px-4 py-3">
                  <Bot size={18} className="shrink-0 text-accent" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-body font-medium text-ink">{item.model}</span>
                      <Chip tone={item.enabled ? "success" : "neutral"}>{modelKindLabel(item.kind)}</Chip>
                      {active && <Chip tone="info">{S.settings.providers.active}</Chip>}
                    </div>
                    {item.context_window && <p className="mt-1 text-fine text-ink-2">{S.settings.providers.context}: {item.context_window.toLocaleString()}</p>}
                  </div>
                  <Checkbox
                    label={item.enabled ? S.settings.providers.modelEnabled : S.settings.providers.modelDisabled}
                    checked={item.enabled}
                    onChange={(checked) => update.mutate({ id: item.id, enabled: checked })}
                    disabled={update.isPending}
                  />
                  <div className="flex items-center gap-1">
                    {item.kind === "chat" && (
                      <Button variant="secondary" size="sm" disabled={active || !item.enabled || activate.isPending} onClick={() => activate.mutate({ id: item.id, modelKind: "chat" })}>
                        {S.settings.providers.setChat}
                      </Button>
                    )}
                    {item.kind === "embedding" && (
                      <Button variant="secondary" size="sm" disabled={active || !item.enabled || activate.isPending} onClick={() => activate.mutate({ id: item.id, modelKind: "embedding" })}>
                        {S.settings.providers.setEmbedding}
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" busy={testing === item.id} onClick={() => test(item)} disabled={testing !== null}>
                      {S.settings.providers.test}
                    </Button>
                    <IconButton label={S.settings.providers.delete} size="sm" variant="ghost" onClick={() => remove.mutate(item.id)} disabled={remove.isPending}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function ModelProviders({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient();
  const providers = useQuery({
    queryKey: ["model-providers", workspaceId],
    queryFn: () => api.modelProviders(workspaceId),
  });
  const [providerEditor, setProviderEditor] = useState<ModelProviderView | null | undefined>(undefined);
  const [modelsProviderId, setModelsProviderId] = useState<string | null>(null);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["model-providers", workspaceId] });
  const remove = useMutation({
    mutationFn: (providerId: string) => api.deleteModelProvider(workspaceId, providerId),
    onSuccess: () => {
      toast.success(S.settings.providers.providerDeleted);
      refresh();
    },
    onError: (error) => toast.error(errorText(error)),
  });
  const toggle = useMutation({
    mutationFn: ({ provider, enabled }: { provider: ModelProviderView; enabled: boolean }) =>
      api.updateModelProvider(workspaceId, provider.id, { enabled }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorText(error)),
  });

  const selectedModelsProvider = providers.data?.providers.find((item) => item.id === modelsProviderId) ?? null;

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-title text-ink">{S.settings.providers.title}</h2>
          <p className="mt-1 max-w-3xl text-small leading-relaxed text-ink-2">{S.settings.providers.hint}</p>
        </div>
        <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setProviderEditor(null)}>
          {S.settings.providers.add}
        </Button>
      </div>

      {providers.isLoading && <p className="text-small text-ink-2">{S.nav.loading}</p>}
      {providers.isError && <p className="flex items-center gap-2 text-small text-danger"><CircleAlert size={15} /> {errorText(providers.error)}</p>}
      {!providers.isLoading && !providers.isError && providers.data?.providers.length === 0 && (
        <div className="rounded-panel border border-dashed border-line p-6 text-small text-ink-2">{S.settings.providers.noProviders}</div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {providers.data?.providers.map((provider) => (
          <article key={provider.id} className="glass overflow-hidden rounded-panel">
            <div className="p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-control bg-accent/10 text-accent"><Bot size={20} /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-title text-ink">{provider.name}</h3>
                    <span className={provider.enabled ? "size-2 rounded-full bg-ok" : "size-2 rounded-full bg-ink-3"} title={provider.enabled ? S.settings.providers.enabled : S.settings.providers.disabled} />
                  </div>
                  <p className="mt-1 truncate text-fine text-ink-2">{provider.provider_id}</p>
                </div>
                <IconButton label={S.settings.providers.edit} size="sm" onClick={() => setProviderEditor(provider)}>
                  <Pencil size={14} />
                </IconButton>
              </div>
              <dl className="mt-4 space-y-2 text-small">
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-ink-2">{S.settings.providers.baseUrl}</dt><dd className="min-w-0 truncate text-ink">{provider.base_url}</dd></div>
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-ink-2">{S.settings.providers.kind}</dt><dd className="text-ink">{providerCapabilities(provider) || "—"}</dd></div>
                <div className="flex gap-3"><dt className="w-20 shrink-0 text-ink-2">{S.settings.providers.apiKey}</dt><dd className="text-ink">{provider.has_api_key ? S.settings.providers.keyConfigured : "—"}</dd></div>
              </dl>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
              <Button variant="secondary" size="sm" icon={<SlidersHorizontal size={14} />} onClick={() => setModelsProviderId(provider.id)}>
                {S.settings.providers.manageModels} <span className="text-ink-2">({provider.models.length})</span>
              </Button>
              <div className="flex items-center gap-3">
                <Checkbox
                  label={provider.enabled ? S.settings.providers.enabled : S.settings.providers.disabled}
                  checked={provider.enabled}
                  onChange={(enabled) => toggle.mutate({ provider, enabled })}
                  disabled={toggle.isPending}
                />
                <IconButton label={S.settings.providers.delete} variant="ghost" size="sm" onClick={() => remove.mutate(provider.id)} disabled={remove.isPending}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          </article>
        ))}
      </div>

      {providerEditor !== undefined && (
        <ProviderEditor
          workspaceId={workspaceId}
          provider={providerEditor}
          onClose={() => setProviderEditor(undefined)}
          onSaved={refresh}
        />
      )}
      {selectedModelsProvider && (
        <ProviderModels
          workspaceId={workspaceId}
          provider={selectedModelsProvider}
          onClose={() => setModelsProviderId(null)}
          onRefresh={refresh}
        />
      )}
    </section>
  );
}
