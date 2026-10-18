export function Panel() {
  return (
    <div className="bg-white text-foreground p-[13px] rounded-[10px]">
      <span className="bg-gray-100 dark:bg-gray-800 text-[15px]">Tag</span>
      <p className="text-gray-500">Muted</p>
      <div className="absolute inset-0" />
      <div style={{ color: '#ff0000' }}>Alert</div>
    </div>
  );
}
