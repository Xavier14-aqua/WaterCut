import { useEffect, useRef, useState } from 'react';

import type {
  Asset,
  Idea,
  IdeaInput,
  LibraryAsset,
  LibraryIdea,
} from '../../../shared/models';

import { emptyPayload } from '../../../shared/models';

import { boardRegion, withBoardRegion } from '../../../shared/board';

import { dateTimeLocalValue, dateTimeLocalToISO } from '../../../shared/dates';

import { PaletteEditor } from './PaletteEditor';

import { kindLabel } from '../resources/kinds';

export function IdeaForm({
  value,
  assets,
  onSave,
  onCancel,
  busy = false,
  heading = '编辑灵感',
  onDraft,
  libraryMode = false,
  mediaScopeId,
}: {
  value?: Idea | LibraryIdea;
  assets: Array<Asset | LibraryAsset>;
  onSave: (input: IdeaInput) => Promise<boolean>;
  onCancel: () => void;
  busy?: boolean;
  heading?: string;
  onDraft?: (input: IdeaInput) => void;
  libraryMode?: boolean;
  mediaScopeId?: string;
}) {
  const [form, setForm] = useState<IdeaInput>(() =>
      value
        ? {
            ...value,
            id: value.id,
            expectedVersion: 'version' in value ? value.version : undefined,
          }
        : {
            kind: 'note',
            text: '',
            tags: '',
            notes: '',
            payload: {
              ...emptyPayload,
            },
            occurredAt: null,
            media: [],
          },
    ),
    [dirty, setDirty] = useState(false);
  const formRef = useRef(form),
    mounted = useRef(true);
  formRef.current = form;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const [assetSearch, setAssetSearch] = useState(''),
    [lookupAssets, setLookupAssets] = useState<LibraryAsset[]>([]);
  useEffect(() => {
    if (!libraryMode) return;
    let live = true;
    const timer = setTimeout(() => {
      void window.watercut
        .readLibrary({
          search: assetSearch,
          limit: 100,
        })
        .then((page) => {
          if (live) setLookupAssets(page.assets);
        })
        .catch(() => undefined);
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [libraryMode, assetSearch]);
  const assetOptions = [
    ...new Map([...assets, ...lookupAssets].map((a) => [a.id, a])).values(),
  ];
  function edit(patch: Partial<IdeaInput>) {
    setDirty(true);
    const next = {
      ...form,
      ...patch,
    };
    setForm(next);
    onDraft?.(next);
  }
  function chooseMedia(
    asset: Asset | LibraryAsset,
    next: NonNullable<IdeaInput['media']>,
  ) {
    edit({
      media: next,
    });
    if (form.kind !== 'mood' || asset.kind !== 'image') return;
    if ('palette' in asset && asset.palette.length) {
      edit({
        payload: {
          ...form.payload,
          colors: asset.palette.slice(0, 4),
        },
        media: next,
      });
      return;
    }
    const scope = 'libraryId' in asset ? asset.libraryId : mediaScopeId;
    if (!scope) return;
    void window.watercut
      .getPalette(`${scope}:${asset.id}`)
      .then((colors) => {
        const latest = formRef.current;
        if (
          !mounted.current ||
          !colors.length ||
          latest.kind !== 'mood' ||
          !latest.media?.some((m) => m.assetId === asset.id) ||
          latest.payload.colors.join() !== form.payload.colors.join()
        )
          return;
        const updated = {
          ...latest,
          payload: {
            ...latest.payload,
            colors,
          },
        };
        setForm(updated);
        onDraft?.(updated);
      })
      .catch(() => undefined);
  }
  function payload(key: keyof typeof emptyPayload, text: string) {
    edit({
      payload: {
        ...form.payload,
        [key]: text,
      },
    });
  }
  const media = form.media ?? [];
  return (
    <form
      className="idea-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave(form)) setDirty(false);
      }}
    >
      <fieldset className="idea-fields" disabled={busy}>
        <h2>{heading}</h2>
        <label>
          类型
          <select
            value={form.kind}
            onChange={(e) =>
              edit({
                kind: e.target.value as IdeaInput['kind'],
              })
            }
          >
            {Object.entries(kindLabel).map(([key, text]) => (
              <option key={key} value={key}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          一句话 / 核心画面
          <textarea
            autoFocus
            value={form.text}
            maxLength={4000}
            onChange={(e) =>
              edit({
                text: e.target.value,
              })
            }
            placeholder="先记下来，细节可以以后补。"
          />
        </label>
        <label>
          标签
          <input
            value={form.tags}
            maxLength={500}
            onChange={(e) =>
              edit({
                tags: e.target.value,
              })
            }
            placeholder="雨后，孤独，便利店"
          />
        </label>
        <label>
          备注
          <textarea
            value={form.notes}
            onChange={(e) =>
              edit({
                notes: e.target.value,
              })
            }
          />
        </label>
        {form.kind === 'mood' && (
          <>
            <label>
              节奏直觉
              <input
                value={form.payload.rhythm}
                onChange={(e) => payload('rhythm', e.target.value)}
                placeholder="先静后动，副歌加快"
              />
            </label>
            <PaletteEditor
              colors={form.payload.colors}
              disabled={busy}
              onChange={(colors) =>
                edit({
                  payload: {
                    ...form.payload,
                    colors,
                  },
                })
              }
            />
          </>
        )}
        {form.kind === 'scene' && (
          <div className="form-grid">
            {(
              [
                ['timeOfDay', '昼夜'],
                ['weather', '天气'],
                ['environment', '环境'],
                ['location', '地点'],
                ['props', '关键道具'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={form.payload[key]}
                  onChange={(e) => payload(key, e.target.value)}
                />
              </label>
            ))}
          </div>
        )}
        <label>
          白板分区
          <input
            aria-label="白板分区"
            placeholder="例如：开场、第二幕"
            value={boardRegion(form.tags)}
            onChange={(e) =>
              edit({
                tags: withBoardRegion(form.tags, e.target.value),
              })
            }
          />
        </label>
        <label>
          事情发生的时间（可留空）
          <input
            type="datetime-local"
            value={dateTimeLocalValue(form.occurredAt)}
            onChange={(e) =>
              edit({
                occurredAt: dateTimeLocalToISO(e.target.value),
              })
            }
          />
        </label>
        <label>
          搜索参考素材
          <input
            aria-label="搜索参考素材"
            placeholder="输入文件名或标签…"
            value={assetSearch}
            onChange={(e) => setAssetSearch(e.target.value)}
          />
        </label>
        <label>
          参考图片 / 音频 / 视频
          <select
            value=""
            onChange={(e) => {
              const asset = assetOptions.find((a) => a.id === e.target.value);
              if (!asset) return;
              const next = [
                ...media,
                {
                  assetId: asset.id,
                  role: asset.kind,
                  position: media.length,
                  inMs: 0,
                  outMs: null,
                },
              ];
              chooseMedia(asset, next);
            }}
          >
            <option value="">选择已导入素材…</option>
            {assetOptions
              .filter(
                (a) =>
                  !media.some((m) => m.assetId === a.id) &&
                  `${a.name} ${a.tags}`
                    .toLowerCase()
                    .includes(assetSearch.toLowerCase()),
              )
              .map((a) => (
                <option value={a.id} key={a.id}>
                  {a.name}
                </option>
              ))}
          </select>
        </label>
        <div className="attachment-list">
          {media.map((m, index) => (
            <div key={m.assetId}>
              <span>
                {assetOptions.find((a) => a.id === m.assetId)?.name ??
                  '已关联参考素材'}{' '}
                · {m.role}
              </span>
              {m.role !== 'image' && (
                <div className="filter-row">
                  <input
                    aria-label="参考入点"
                    type="number"
                    min="0"
                    step=".1"
                    value={m.inMs / 1000}
                    onChange={(e) =>
                      edit({
                        media: media.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                inMs: Math.round(Number(e.target.value) * 1000),
                              }
                            : item,
                        ),
                      })
                    }
                  />
                  <input
                    aria-label="参考出点"
                    type="number"
                    min=".1"
                    step=".1"
                    placeholder="片尾"
                    value={m.outMs === null ? '' : m.outMs / 1000}
                    onChange={(e) =>
                      edit({
                        media: media.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                outMs: e.target.value
                                  ? Math.round(Number(e.target.value) * 1000)
                                  : null,
                              }
                            : item,
                        ),
                      })
                    }
                  />
                </div>
              )}
              <button
                type="button"
                className="quiet"
                onClick={() =>
                  edit({
                    media: media.filter((_, i) => i !== index),
                  })
                }
              >
                移除引用
              </button>
            </div>
          ))}
        </div>
        <div className="form-actions">
          <button disabled={busy || !form.text.trim()} type="submit">
            {onDraft ? '立即保存' : '保存'}
            {dirty && !onDraft ? '编辑' : ''}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              if (
                onDraft ||
                !dirty ||
                window.confirm('放弃尚未保存的灵感编辑？')
              )
                onCancel();
            }}
          >
            关闭
          </button>
        </div>
        <small className="muted">
          {onDraft
            ? '项目编辑自动保存；保存状态见顶栏。'
            : value && 'sourceIdeaId' in value
              ? '这里的编辑仅保存到所选项目，点击“保存”生效。'
              : '参考图可选；情绪卡最多三张。'}
        </small>
      </fieldset>
    </form>
  );
}
