// 写队列：同一文件的写操作串行执行，不同文件可并行
// 确保并发安全，避免同时写同一文件导致数据损坏

type Writer = () => Promise<void>;

class WriteQueue {
  private queues: Map<string, Promise<void>> = new Map();

  async enqueue(filePath: string, writer: Writer): Promise<void> {
    const key = filePath;
    const previous = this.queues.get(key) || Promise.resolve();
    // 无论前一个操作成功或失败，都继续执行后续写入
    const next = previous.then(() => writer(), () => writer());
    this.queues.set(key, next);

    try {
      await next;
    } finally {
      if (this.queues.get(key) === next) {
        this.queues.delete(key);
      }
    }
  }

  /** 在复制完整资源库前等待已提交的写入完成，避免备份得到半写入文件。 */
  async drain(): Promise<void> {
    await Promise.all([...this.queues.values()].map((pending) => pending.catch(() => undefined)));
  }
}

export const writeQueue = new WriteQueue();
