import { useEffect, useState } from 'react';
import type { Project, Revision, PackageResult,ShotListFilter } from '../../../shared/models';
import { jianyingCompatibility } from '../../../shared/jianying-compatibility';
export function DeliveryPanel({
  project,
  busy,
  onRun,
  onClose,
  onNotice,shotListFilter
}: {
  project: Project;
  busy: boolean;
  onRun: (action: () => Promise<unknown>) => Promise<boolean>;
  onClose: () => void;
  onNotice: (message: string) => void;
  shotListFilter?:ShotListFilter;
}) {
  const [revisions, setRevisions] = useState<Revision[]>([]),
    [name, setName] = useState(''),
    [history, setHistory] = useState(true),
    [media, setMedia] = useState(true),
    [landscape, setLandscape] = useState(true),
    [checklist, setChecklist] = useState(false),
    [lastPackage, setLastPackage] = useState<PackageResult | null>(null),
    [pdf, setPDF] = useState(''),[placeholders,setPlaceholders]=useState(true),[handoff,setHandoff]=useState(''),[rate,setRate]=useState(project.timelineSettings.fpsNum/project.timelineSettings.fpsDen);
  function load() {
    void window.watercut.listRevisions(project.directory).then(setRevisions).catch(e => onNotice(String(e)));
  }
  useEffect(load, [project.id, project.revision]);
  const missing = project.assets.filter(a => a.missing),
    unknown = project.assets.filter(a => a.kind !== 'image' && a.metadata?.status !== 'ready');
  return <div className="modal-backdrop"><section className="modal delivery-panel" aria-label="版本与交付"><div className="section-heading"><div><p className="eyebrow">SAVE & DELIVER</p><h2>版本与交付</h2></div><button className="quiet" disabled={busy} onClick={onClose}>关闭</button></div>
    {busy && <div className="delivery-task" role="status"><span>正在处理，完成前请稍候。</span><button className="secondary" onClick={() => void window.watercut.cancelImport()}>取消任务</button></div>}
    <section className="delivery-section"><h3>版本快照</h3><p className="muted">记录当前的脚本、分镜、白板和素材关联。恢复前自动保留当前状态。快照需要原件，完整迁移请导出项目包。</p><div className="toolbar"><input aria-label="快照名称" placeholder="例如：V1 快剪版" maxLength={100} value={name} disabled={busy} onChange={e => setName(e.target.value)} /><button disabled={busy || !name.trim()} onClick={() => void onRun(async () => {
            const list = await window.watercut.createRevision(project.directory, name);
            if (list) {
              setRevisions(list);
              setName('');
            }
            return list;
          })}>创建快照</button></div>
      <div className="revision-list">{!revisions.length && <small>还没有快照。</small>}{revisions.map(r => <article className="revision-row" key={r.id}><div><strong>{r.name}</strong><small>{r.automatic ? '恢复前自动保存 · ' : ''}{new Date(r.createdAt).toLocaleString('zh-CN')} · {r.assetCount} 份素材</small></div><button className="secondary" disabled={busy} onClick={() => {
              if (window.confirm(`恢复“${r.name}”？当前状态会先自动创建快照。`)) void onRun(() => window.watercut.restoreRevision(project.directory, r.id)).then(ok => {
                if (ok) load();
              });
            }}>恢复</button><button className="quiet" disabled={busy} onClick={() => {
              if (window.confirm('删除这条快照记录？当前项目和原件不会被删除。')) void onRun(async () => {
                setRevisions(await window.watercut.deleteRevision(project.directory, r.id));
                return true;
              });
            }}>删除</button></article>)}</div>
    </section>
    <section className="delivery-section"><h3>独立项目包</h3><p className="muted">包含本项目的全局引用、候选素材和灵感附件。导入时创建独立副本，不会覆盖原项目。</p><div className="filter-chips"><label><input type="checkbox" checked={media} disabled={busy} onChange={e => setMedia(e.target.checked)} />包含原件</label><label><input type="checkbox" checked={history} disabled={busy} onChange={e => setHistory(e.target.checked)} />包含全部快照</label></div>{(!media || missing.length > 0) && <p className="delivery-warning">{!media ? '未勾选原件：此项目包不能作为完整备份。' : `当前有 ${missing.length} 份素材缺失：${missing.slice(0, 5).map(a => a.name).join('、')}。导出会明确标记缺失。`}</p>}<button disabled={busy} onClick={() => void onRun(async () => {
          const result = await window.watercut.exportProjectPackage(project.directory, {
            includeHistory: history,
            includeMedia: media
          });
          if (result) setLastPackage(result);
          return result;
        })}>导出项目包 ZIP</button>
      {lastPackage && <div className={lastPackage.complete ? 'delivery-success' : 'delivery-warning'} role="status"><strong>{lastPackage.complete ? '完整项目包已导出' : '已导出不完整项目包'}</strong><p className="path">{lastPackage.file}</p>{!lastPackage.complete && <p>{lastPackage.missing.map(m => `${m.name}：${m.reason}`).slice(0, 20).join('；')}</p>}</div>}
    </section>
    <section className="delivery-section"><h3>分镜 / 待拍清单 PDF</h3><p className="muted">A4 表格，包含主画面、镜号、画面描述、动作 / 对白、景别、运镜、时长和来源。长文本自动续行。</p><div className="filter-chips"><label><input type="checkbox" checked={landscape} disabled={busy} onChange={e => setLandscape(e.target.checked)} />A4 横版</label><label><input type="checkbox" checked={checklist} disabled={busy} onChange={e => setChecklist(e.target.checked)} />仅导出待拍 / 缺口</label></div><button disabled={busy} onClick={() => void onRun(async () => {
          const file = await window.watercut.exportStoryboardPDF(project.directory, {
            landscape,
            checklist,filter:checklist?shotListFilter:undefined
          });
          if (file) setPDF(file);
          return file;
        })}>导出 PDF</button>{pdf && <p className="path delivery-success">PDF 已导出：{pdf}</p>}
    </section>
    <section className="delivery-section"><h3>剪映专业版草稿交接</h3><p className="muted">复制所用原件，生成单视频轨和 BGM 轨。已在剪映专业版 {jianyingCompatibility.version}（Windows）验证基础直切、占位图、原声与 BGM。导出时请选择剪映的本地草稿目录；其他版本需另行验证。</p><div className="form-grid"><label>序列帧率<select aria-label="交接序列帧率" value={rate} disabled={busy} onChange={e=>setRate(Number(e.target.value))}>{[24,25,30,50,60].map(n=><option value={n} key={n}>{n} fps</option>)}{![24,25,30,50,60].includes(rate)&&<option value={rate}>{rate} fps（当前）</option>}</select></label><label className="checkbox-label"><input type="checkbox" checked={placeholders} disabled={busy} onChange={e=>setPlaceholders(e.target.checked)}/>缺素材镜头生成文字占位图</label></div><button disabled={busy||!project.shots.length} onClick={()=>void onRun(async()=>{await window.watercut.saveTimelineSettings(project.directory,{...project.timelineSettings,fpsNum:rate,fpsDen:1});const result=await window.watercut.exportJianying(project.directory,{placeholders});if(result)setHandoff(result.directory);return await window.watercut.readProject(project.directory);})}>导出剪映草稿文件夹</button>{handoff&&<p className="path delivery-success">草稿已导出，可在剪映本地草稿列表打开：{handoff}</p>}</section>
    <section className="delivery-section"><h3>素材检查</h3><p className="muted">{missing.length} 份原件缺失；{unknown.length} 份音视频尚未完成离线探测。未知参数保留为空，不冒充精确逐帧信息。</p><button disabled={busy || !project.assets.length} className="secondary" onClick={() => void onRun(() => window.watercut.probeProject(project.directory))}>探测项目素材</button></section>
  </section></div>;
}
