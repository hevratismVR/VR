export default function LoadingScreen() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="spinner w-12 h-12 border-4"></div>
      <p className="text-dark-300 text-sm">Loading model...</p>
    </div>
  )
}
