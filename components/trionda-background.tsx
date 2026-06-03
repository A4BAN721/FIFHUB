export function TriondaBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(15,23,42,0.88),transparent_24%),radial-gradient(circle_at_bottom_right,_rgba(14,165,233,0.12),transparent_22%),radial-gradient(circle_at_center,_rgba(239,68,68,0.08),transparent_30%)]" />

      <div className="absolute -right-16 top-0 h-[120vh] w-[120vh] opacity-70">
      <div className="absolute inset-0 host-pattern" />
      </div>
    </div>
  );
}
