'use client';

import { useCallback, useRef, useState } from 'react';
import type { BackgroundEffect, BackgroundImagePresetId } from '@jehydro/shared-types';
import { BACKGROUND_IMAGE_PRESETS } from '@jehydro/shared-types';

interface BackgroundEffectToggleProps {
  currentEffect: BackgroundEffect;
  onEffectChange: (effect: BackgroundEffect, imageId?: BackgroundImagePresetId) => void;
}

export function BackgroundEffectToggle({
  currentEffect,
  onEffectChange,
}: BackgroundEffectToggleProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const handleSelect = useCallback(
    (effect: BackgroundEffect, imageId?: BackgroundImagePresetId) => {
      onEffectChange(effect, imageId);
      setOpen(false);
    },
    [onEffectChange]
  );

  // Close on click outside
  const handleBlur = useCallback((e: React.FocusEvent) => {
    if (!panelRef.current?.contains(e.relatedTarget as Node)) {
      setOpen(false);
    }
  }, []);

  return (
    <div className="relative" ref={panelRef} onBlur={handleBlur}>
      {/* Toggle button */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          currentEffect !== 'none'
            ? 'bg-violet-600 text-white hover:bg-violet-500'
            : 'bg-slate-700/50 text-slate-300 hover:bg-slate-600/50 hover:text-white'
        }`}
        title="Background effects"
        aria-label="Background effects"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <span className="hidden sm:inline">Background</span>
        {currentEffect !== 'none' && (
          <span className="ml-1 rounded-full bg-white/20 px-1.5 text-[10px] font-bold">ON</span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-48 rounded-xl border border-slate-600/50 bg-slate-800 p-2 shadow-2xl">
          {/* None */}
          <button
            type="button"
            onClick={() => handleSelect('none')}
            className={`w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              currentEffect === 'none'
                ? 'bg-violet-600/20 text-violet-300'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            No effect
          </button>

          {/* Blur */}
          <button
            type="button"
            onClick={() => handleSelect('blur')}
            className={`mt-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              currentEffect === 'blur'
                ? 'bg-violet-600/20 text-violet-300'
                : 'text-slate-300 hover:bg-slate-700'
            }`}
          >
            Blur background
          </button>

          {/* Divider */}
          <div className="my-2 border-t border-slate-600/50" />

          {/* Image presets */}
          {BACKGROUND_IMAGE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => handleSelect('image', preset.id)}
              className={`mt-1 w-full rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                currentEffect === 'image'
                  ? 'bg-violet-600/20 text-violet-300'
                  : 'text-slate-300 hover:bg-slate-700'
              }`}
            >
              {preset.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
