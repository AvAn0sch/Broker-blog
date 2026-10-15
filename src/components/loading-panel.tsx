/** 列表与读取的加载态：由各路由的 loading.tsx 使用。 */
export function LoadingPanel({ label }: { label: string }) {
  return (
    <section className="panel loading-panel" role="status" aria-live="polite">
      <span className="loading-dot" aria-hidden="true" />
      {label}
    </section>
  );
}
