"use client"

export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 mr-auto animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div
        className="w-2 h-2 rounded-full bg-stone-300 animate-bounce"
        style={{ animationDelay: "0ms" }}
      />
      <div
        className="w-2 h-2 rounded-full bg-stone-300 animate-bounce"
        style={{ animationDelay: "150ms" }}
      />
      <div
        className="w-2 h-2 rounded-full bg-stone-300 animate-bounce"
        style={{ animationDelay: "300ms" }}
      />
    </div>
  )
}
