import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  children: ReactNode;
  scope: 'app' | 'inspector';
  resetKey?: string;
  onReset: () => void;
};

export class UIErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo) {
    try {
      window.watercut.reportUIError({
        scope: this.props.scope,
        message: String(error.message || error).slice(0, 4000),
        stack: `${error.stack ?? ''}\n${info.componentStack ?? ''}`.slice(0, 20000)
      });
    } catch { /* The recovery screen must also work if preload is unavailable. */ }
  }

  componentDidUpdate(previous: Props) {
    if (this.state.failed && previous.resetKey !== this.props.resetKey) this.setState({ failed: false });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    const inspector = this.props.scope === 'inspector';
    const content = <div className="error-recovery" role="alert">
      <p className="eyebrow">WATERCUT</p>
      <h2>{inspector ? '详情暂时无法显示' : '界面遇到了问题'}</h2>
      <p>{inspector ? '可以关闭详情，继续操作项目，再重新打开这张卡片。' : '已保存的项目仍在本地。重新加载界面后，可以再次打开项目。'}</p>
      <div className="toolbar">
        <button onClick={() => { this.setState({ failed: false }); this.props.onReset(); }}>{inspector ? '关闭详情' : '重新加载界面'}</button>
        <button className="secondary" onClick={() => window.watercut.requestClose()}>退出程序</button>
      </div>
      <small>错误详情已记录在本机日志中。</small>
    </div>;
    return inspector ? <aside className="inspector">{content}</aside> : <main className="app-recovery">{content}</main>;
  }
}
