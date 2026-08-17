type PageLoadingProps = {
  label: string;
};

export default function PageLoading({ label }: PageLoadingProps) {
  return (
    <div className="page-loading-unified" role="status" aria-live="polite">
      <span className="page-loading-unified-spinner" aria-hidden="true" />
      <strong>{label}</strong>
    </div>
  );
}
