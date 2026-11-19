type CloseOptions = {
  requestSave: (requestId: number) => void;
  confirmExit: () => Promise<boolean>;
  close: () => void;
  forceClose: () => void;
  timeoutMs?: number;
};

// A renderer can fail before it acknowledges the save/close request. Keep the
// final exit decision in the main process, with a native confirmation dialog.
export class WindowCloseGuard {
  private serial = 0;
  private requestId: number | null = null;
  private approved = false;
  private unavailable = false;
  private disposed = false;
  private prompting = false;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private options: CloseOptions) {}

  allowClose(): boolean {
    if (this.disposed) return true;
    if (this.approved) {
      this.dispose();
      return true;
    }
    if (this.requestId !== null) {
      void this.prompt();
      return false;
    }
    this.requestId = ++this.serial;
    if (this.unavailable) void this.prompt();
    else {
      this.armTimer();
      try { this.options.requestSave(this.requestId); }
      catch { this.markUnavailable(); }
    }
    return false;
  }

  acknowledge(requestId: number, saved: boolean) {
    if (this.disposed || requestId !== this.requestId) return;
    this.clearTimer();
    this.requestId = null;
    if (!saved) return;
    this.approved = true;
    this.options.close();
  }

  markUnavailable() {
    this.unavailable = true;
    if (this.requestId !== null) void this.prompt();
  }

  markResponsive() { this.unavailable = false; }

  dispose() {
    this.disposed = true;
    this.clearTimer();
    this.requestId = null;
  }

  private clearTimer() {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private armTimer() {
    this.clearTimer();
    this.timer = setTimeout(() => void this.prompt(), this.options.timeoutMs ?? 5000);
  }

  private async prompt() {
    if (this.disposed || this.prompting || this.requestId === null) return;
    this.prompting = true;
    this.clearTimer();
    const requestId = this.requestId;
    try {
      const exit = await this.options.confirmExit();
      if (this.disposed || requestId !== this.requestId) return;
      if (exit) {
        this.dispose();
        this.options.forceClose();
      } else this.armTimer();
    } catch {
      if (!this.disposed && requestId === this.requestId) this.armTimer();
    } finally {
      this.prompting = false;
    }
  }
}
