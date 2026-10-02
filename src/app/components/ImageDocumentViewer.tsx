import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Maximize2, Minimize2, ZoomIn, ZoomOut } from 'lucide-react';
import { Button } from './ui/button';
import { getImageVariant, imageFitRatios, imageSwipeDirection } from '../imageNavigation';
import type { ImageOrientation, PriceImage } from '../priceFiles';

interface ImageDocumentViewerProps {
  name: string;
  src: string;
  variants?: PriceImage['variants'];
  index: number;
  count: number;
  onNavigate: (index: number) => void;
  onBack: () => void;
}

export function ImageNavigation({ index, count, onNavigate }: Pick<ImageDocumentViewerProps, 'index' | 'count' | 'onNavigate'>) {
  return <nav className="document-pagination" aria-label="이미지 넘기기">
    <Button type="button" variant="ghost" size="sm" disabled={index <= 0} onClick={() => onNavigate(index - 1)} aria-label="이전 이미지"><ChevronLeft size={20} />이전</Button>
    <output aria-label="현재 이미지 순서" aria-live="polite">{index + 1} / {count}</output>
    <Button type="button" variant="ghost" size="sm" disabled={index >= count - 1} onClick={() => onNavigate(index + 1)} aria-label="다음 이미지">다음<ChevronRight size={20} /></Button>
  </nav>;
}

export function ImageOrientationControl({ variants, orientation, onChange }: {
  variants: NonNullable<PriceImage['variants']>;
  orientation?: ImageOrientation;
  onChange: (orientation: ImageOrientation) => void;
}) {
  return <div className="document-orientation" role="group" aria-label="가격표 방향">
    {(['landscape', 'portrait'] as const).map(value => <Button key={value} type="button" variant="ghost" size="sm"
      aria-label={value === 'landscape' ? '가로 가격표' : '세로 가격표'} aria-pressed={orientation === value}
      disabled={!variants[value]} onClick={() => onChange(value)}>{value === 'landscape' ? '가로' : '세로'}</Button>)}
  </div>;
}

export function ImageDocumentViewer({ name, src: defaultSource, variants, index, count, onNavigate, onBack }: ImageDocumentViewerProps) {
  const [preferredOrientation, setPreferredOrientation] = useState<ImageOrientation>('landscape');
  const { src, orientation } = getImageVariant({ src: defaultSource, variants }, preferredOrientation);
  const [large, setLarge] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [mode, setMode] = useState<'width' | 'page' | 'manual'>('page');
  const [zoom, setZoom] = useState(1);
  const [loadedImage, setLoadedImage] = useState({ src: '', width: 1334, height: 1888 });
  const natural = loadedImage.src === src ? loadedImage : { width: 1334, height: 1888 };
  const [viewport, setViewport] = useState({ width: 640, height: 540 });
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const failed = failedSource === src;
  const stage = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const swipe = useRef<{ x: number; y: number; time: number; id: number } | null>(null);
  const tap = useRef<{ x: number; y: number; id: number } | null>(null);

  useEffect(() => { panel.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    setMode('page');
    setControlsVisible(false);
    stage.current?.scrollTo({ left: 0, top: 0 });
    swipe.current = null;
    tap.current = null;
  }, [src]);

  useEffect(() => {
    if (large && !controlsVisible) panel.current?.focus({ preventScroll: true });
  }, [large, controlsVisible]);

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setViewport({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, [large]);

  useEffect(() => {
    if (!large) return;
    panel.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLarge(false);
        requestAnimationFrame(() => expandButton.current?.focus());
      }
      if (event.key === 'Tab') {
        if (!controlsVisible) {
          event.preventDefault();
          setControlsVisible(true);
          requestAnimationFrame(() => panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());
          return;
        }
        const buttons = Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []).filter(button => button.getClientRects().length > 0);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) {
          event.preventDefault(); first?.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [large, controlsVisible]);

  const { width: widthRatio, page: pageRatio } = imageFitRatios(natural, viewport, large ? 0 : 16);
  const ratio = mode === 'width' ? widthRatio : mode === 'page' ? pageRatio : zoom;
  const navigate = (delta: number) => {
    const next = index + delta;
    if (next >= 0 && next < count) onNavigate(next);
  };
  const canSwipe = count > 1 && ratio <= widthRatio + 0.001;
  const changeZoom = (factor: number) => {
    setZoom(Math.max(0.1, Math.min(3, ratio * factor)));
    setMode('manual');
  };
  const fit = (next: 'width' | 'page') => {
    setMode(next);
    stage.current?.scrollTo({ left: 0, top: 0 });
  };
  const toggleFullscreen = () => {
    fit('page');
    setControlsVisible(false);
    setLarge(!large);
  };

  const content = <div
    ref={panel}
    className={`document-viewer ${large ? 'document-viewer-large' : ''}`}
    role={large ? 'dialog' : 'region'}
    aria-label={name}
    aria-modal={large ? true : undefined}
    tabIndex={-1}
    onKeyDown={event => {
      if (large && (event.key === 'Enter' || event.key === ' ') && (event.target === panel.current || event.target === stage.current)) {
        event.preventDefault();
        setControlsVisible(visible => !visible);
        return;
      }
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || (event.target as HTMLElement).closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        event.stopPropagation();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    }}
  >
    <div className="document-toolbar" hidden={large && !controlsVisible}>
      <Button variant="ghost" size="sm" onClick={() => { setLarge(false); onBack(); }} aria-label="파일 목록으로 돌아가기">
        <ArrowLeft size={16} /> 목록
      </Button>
      <span className="document-title">{name}</span>
      {variants && <ImageOrientationControl variants={variants} orientation={orientation} onChange={value => { setPreferredOrientation(value); fit('page'); }} />}
      <div className="document-actions">
        <Button variant="ghost" size="icon" onClick={() => changeZoom(1 / 1.25)} aria-label="축소" disabled={ratio <= 0.1}><ZoomOut size={18} /></Button>
        <output aria-label="확대 비율">{Math.round(ratio * 100)}%</output>
        <Button variant="ghost" size="icon" onClick={() => changeZoom(1.25)} aria-label="확대" disabled={ratio >= 3}><ZoomIn size={18} /></Button>
        <Button variant="ghost" size="sm" onClick={() => fit('width')} aria-pressed={mode === 'width'}>너비 맞춤</Button>
        <Button variant="ghost" size="sm" onClick={() => fit('page')} aria-pressed={mode === 'page'}>한 장 보기</Button>
        <button ref={expandButton} className="document-expand" onClick={toggleFullscreen}>
          {large ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {large ? '창으로 보기' : '전체화면'}
        </button>
      </div>
    </div>
    {large && <span className="sr-only">화면을 누르면 도구를 표시하거나 숨깁니다. 좌우로 밀어 이미지를 넘길 수 있습니다. Esc 키로 전체화면을 닫습니다.</span>}
    <div ref={stage} className={`document-stage ${mode === 'page' ? 'document-stage-page' : ''}`} tabIndex={0} aria-label="가격표 이미지 열람 영역"
      style={{ touchAction: canSwipe ? 'pan-y pinch-zoom' : 'auto' }}
      onPointerDown={event => {
        tap.current = large && event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, id: event.pointerId } : null;
      }}
      onPointerMove={event => {
        const start = tap.current;
        if (start && (Math.abs(event.clientX - start.x) > 10 || Math.abs(event.clientY - start.y) > 10)) tap.current = null;
      }}
      onPointerCancel={() => { tap.current = null; }}
      onPointerUp={event => {
        const start = tap.current;
        tap.current = null;
        if (start && start.id === event.pointerId && Math.abs(event.clientX - start.x) <= 10 && Math.abs(event.clientY - start.y) <= 10) setControlsVisible(visible => !visible);
      }}
      onTouchStart={event => {
        swipe.current = null;
        if (!canSwipe || event.touches.length !== 1 || (window.visualViewport?.scale ?? 1) > 1.01 || event.currentTarget.scrollWidth > event.currentTarget.clientWidth + 2) return;
        const touch = event.touches[0];
        swipe.current = { x: touch.clientX, y: touch.clientY, time: event.timeStamp, id: touch.identifier };
      }}
      onTouchMove={event => {
        if (!swipe.current) return;
        const touch = event.touches[0];
        if (event.touches.length !== 1 || touch.identifier !== swipe.current.id || Math.abs(touch.clientY - swipe.current.y) > 35) swipe.current = null;
      }}
      onTouchCancel={() => { swipe.current = null; }}
      onTouchEnd={event => {
        const start = swipe.current;
        swipe.current = null;
        if (!start || event.touches.length) return;
        const touch = Array.from(event.changedTouches).find(item => item.identifier === start.id);
        if (!touch) return;
        const direction = imageSwipeDirection(touch.clientX - start.x, touch.clientY - start.y, event.timeStamp - start.time);
        if (direction) navigate(direction);
      }}
    >
      {failed ? <div role="alert" className="document-error">이미지를 불러오지 못했습니다. 다른 이미지를 넘겨 보거나 목록에서 다시 열어 주세요.</div> :
        <div className="document-canvas">
          <img
            key={src}
            src={src}
            alt={`${name}${orientation ? orientation === 'landscape' ? ' 가로' : ' 세로' : ''} 가격표 원본 이미지`}
            style={mode === 'page' ? undefined : { width: `${Math.floor(natural.width * ratio)}px` }}
            draggable={false}
            onLoad={(event) => setLoadedImage({ src, width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
            onError={() => setFailedSource(src)}
          />
        </div>}
    </div>
    <footer className="document-status document-gallery-status" hidden={large && !controlsVisible}><span>원본 이미지</span><ImageNavigation index={index} count={count} onNavigate={onNavigate} /></footer>
  </div>;

  return large ? createPortal(content, document.body) : content;
}
