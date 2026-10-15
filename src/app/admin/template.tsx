/** Re-mounts on every navigation inside /admin, giving each page an entrance transition. */
export default function AdminTemplate({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
