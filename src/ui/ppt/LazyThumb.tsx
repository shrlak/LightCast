// Draws its children (a slide thumbnail) only once it scrolls into view, then keeps them: a long deck in the
// Reuse Slides picker no longer mounts every slide canvas at once.
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function LazyThumb({ children, margin = 160 }: { children: ReactNode; margin?: number }) {
  const box = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    const el = box.current;
    if (seen || !el) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { setSeen(true); io.disconnect(); } }, { rootMargin: `${margin}px` });
    io.observe(el);
    return () => io.disconnect();
  }, [seen, margin]);
  return <span ref={box} className="lazy-thumb" style={{ display: 'block', width: '100%', height: '100%', background: seen ? undefined : '#e1dfdd' }}>{seen ? children : null}</span>;
}
