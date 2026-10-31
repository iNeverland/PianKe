import AppIcon from './AppIcon';

interface ErrorStateProps {
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
}

/**
 * 页面级加载失败态。
 *
 * 与 EmptyState 的区别：EmptyState 表示“确实没有数据”，ErrorState 表示
 * “加载失败，数据未知”。两者不能混用，否则网络/鉴权失败会伪装成空库。
 */
export default function ErrorState({
  title = '加载失败',
  description = '无法连接云端或登录状态已失效，请检查网络后重试。',
  onRetry,
  retryLabel = '重试',
}: ErrorStateProps) {
  return (
    <div className="empty-state" role="alert">
      <div style={{ color: 'var(--text-muted)', marginBottom: '16px' }}>
        <AppIcon name="warning" className="w-10 h-10" />
      </div>
      <h3>{title}</h3>
      <p>{description}</p>
      {onRetry && (
        <div style={{ marginTop: '20px' }}>
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            {retryLabel}
          </button>
        </div>
      )}
    </div>
  );
}
