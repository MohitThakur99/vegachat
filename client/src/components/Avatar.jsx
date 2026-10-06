import { useState } from 'react';
import { Users } from 'lucide-react';
import { initialsOf } from '../lib/format.js';

// Full class names, so Tailwind can see them at build time.
const COLORS = [
  'bg-rose-500',
  'bg-amber-500',
  'bg-emerald-500',
  'bg-sky-500',
  'bg-indigo-500',
  'bg-fuchsia-500',
  'bg-teal-500',
  'bg-orange-500',
];

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-20 w-20 text-2xl',
};

/** The same id always gets the same colour. */
function colorFor(id) {
  let hash = 0;
  for (const char of String(id ?? '')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/**
 * @param {object} props
 * @param {string} props.id            Seeds the fallback colour.
 * @param {string} props.name
 * @param {string|null} [props.src]
 * @param {'sm'|'md'|'lg'|'xl'} [props.size]
 * @param {boolean} [props.group]      Show a group glyph instead of initials.
 * @param {boolean} [props.online]     Show a presence dot; omit to show none.
 */
export default function Avatar({ id, name, src, size = 'md', group = false, online }) {
  const [failedSrc, setFailedSrc] = useState(null);
  const showImage = src && failedSrc !== src;

  return (
    <span className={`relative inline-flex shrink-0 ${SIZES[size]}`}>
      {showImage ? (
        <img
          src={src}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(src)}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-full w-full select-none items-center justify-center rounded-full font-semibold text-white ${colorFor(id)}`}
        >
          {group ? <Users className="h-1/2 w-1/2" /> : initialsOf(name)}
        </span>
      )}
      {online !== undefined && (
        <span
          title={online ? 'Online' : 'Offline'}
          className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-slate-900 ${
            online ? 'bg-emerald-500' : 'bg-slate-400'
          }`}
        />
      )}
    </span>
  );
}
