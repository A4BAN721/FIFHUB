export function TriondaBackground() {
  return (
    <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
      <div className="absolute inset-0 bg-background" />
      <div className="absolute inset-0 background-flow opacity-90" />
      <div className="absolute inset-0 background-glow" />
    </div>
  );
}
