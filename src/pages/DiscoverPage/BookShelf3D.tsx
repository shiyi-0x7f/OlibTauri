import { useState, useRef, useCallback } from "react";
import { BookOpen, Heart, ChevronLeft, ChevronRight } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Book } from "./types";
import { formatFileSize } from "./utils";

interface BookShelf3DProps {
  books: Book[];
  currentIndex: number;
  getCoverUrl: (bookId: string, fallback?: string) => string | undefined;
  handleCoverError: (bookId: string) => void;
  onCardClick: (book: Book) => void;
  onFavorite: (book: Book) => void;
  onNavigate: (direction: 'left' | 'right') => void;
}

const BOOK_WIDTH = 160;
const BOOK_HEIGHT = 230;
const SPINE_WIDTH = 20;
const VISIBLE_RANGE = 3; // Show ±3 books from center

export default function BookShelf3D({
  books, currentIndex,
  getCoverUrl, handleCoverError,
  onCardClick, onFavorite, onNavigate,
}: BookShelf3DProps) {
  const [hoveredCenter, setHoveredCenter] = useState(false);
  const [favAnimating, setFavAnimating] = useState(false);
  const wheelCooldown = useRef(false);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (wheelCooldown.current) return;
    wheelCooldown.current = true;
    if (e.deltaY > 0 || e.deltaX > 0) {
      onNavigate('right');
    } else if (e.deltaY < 0 || e.deltaX < 0) {
      onNavigate('left');
    }
    setTimeout(() => { wheelCooldown.current = false; }, 300);
  }, [onNavigate]);

  const handleFavoriteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const book = books[currentIndex];
    if (!book || favAnimating) return;
    setFavAnimating(true);
    onFavorite(book);
    setTimeout(() => setFavAnimating(false), 600);
  };

  const centerBook = books[currentIndex];
  const canGoLeft = currentIndex > 0;
  const canGoRight = currentIndex < books.length - 1;

  return (
    <div
      onWheel={handleWheel}
      style={{
        position: 'relative',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '0px',
        userSelect: 'none',
      }}
    >
      {/* === Upper section: 3D Bookshelf === */}
      <div style={{
        position: 'relative',
        width: '100%',
        height: 'calc(100vh - 360px)',
        minHeight: '320px',
        maxHeight: '460px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-end',
        perspective: '1200px',
        perspectiveOrigin: '50% 40%',
        overflow: 'visible',
      }}>
        {/* Ambient glow behind center book */}
        <div style={{
          position: 'absolute',
          top: '45%',
          left: '50%',
          transform: 'translate(-50%, -60%)',
          width: '250px',
          height: '300px',
          background: 'radial-gradient(ellipse, var(--accent-glow, rgba(120,80,255,0.15)) 0%, transparent 70%)',
          opacity: 0.6,
          pointerEvents: 'none',
          filter: 'blur(40px)',
          transition: 'opacity 0.4s',
        }} />

        {/* Books container */}
        <div style={{
          position: 'relative',
          width: '100%',
          height: `${BOOK_HEIGHT + 80}px`,
          transformStyle: 'preserve-3d',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}>
          <AnimatePresence mode="popLayout">
            {books.map((book, index) => {
              const offset = index - currentIndex;
              if (Math.abs(offset) > VISIBLE_RANGE) return null;

              const isFront = offset === 0;
              const absOffset = Math.abs(offset);

              // Carousel positioning calculations
              const translateX = offset * 130;
              const translateZ = isFront ? 60 : -absOffset * 50;
              const rotateY = offset * -25;
              const scale = isFront ? 1 : Math.max(0.55, 1 - absOffset * 0.15);
              const opacity = isFront ? 1 : Math.max(0.3, 1 - absOffset * 0.25);
              const zIndex = 10 - absOffset;

              const coverUrl = getCoverUrl(String(book.id), book.cover);

              return (
                <motion.div
                  key={book.id}
                  layout
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{
                    opacity,
                    scale,
                    x: translateX,
                    z: translateZ,
                    rotateY: rotateY,
                  }}
                  exit={{ opacity: 0, scale: 0.5 }}
                  transition={{
                    type: 'spring',
                    stiffness: 300,
                    damping: 30,
                    mass: 0.8,
                  }}
                  style={{
                    position: 'absolute',
                    width: `${BOOK_WIDTH}px`,
                    height: `${BOOK_HEIGHT}px`,
                    transformStyle: 'preserve-3d',
                    cursor: isFront ? 'pointer' : 'default',
                    zIndex,
                    bottom: '40px',
                    filter: isFront ? 'none' : `brightness(${0.7 - absOffset * 0.05})`,
                  }}
                  onClick={() => isFront && onCardClick(book)}
                  onMouseEnter={() => isFront && setHoveredCenter(true)}
                  onMouseLeave={() => isFront && setHoveredCenter(false)}
                >
                  {/* Book front face (cover) */}
                  <div style={{
                    position: 'absolute',
                    width: '100%',
                    height: '100%',
                    backfaceVisibility: 'hidden',
                    borderRadius: '4px 8px 8px 4px',
                    overflow: 'hidden',
                    boxShadow: isFront
                      ? '4px 8px 30px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)'
                      : '2px 4px 12px rgba(0,0,0,0.4)',
                    background: 'var(--bg-tertiary)',
                  }}>
                    {coverUrl ? (
                      <img
                        src={coverUrl}
                        alt={book.title}
                        draggable={false}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          pointerEvents: 'none',
                        }}
                        onError={() => handleCoverError(String(book.id))}
                      />
                    ) : (
                      <div style={{
                        width: '100%', height: '100%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: 'linear-gradient(145deg, var(--bg-secondary) 0%, var(--bg-tertiary) 100%)',
                      }}>
                        <BookOpen size={40} style={{ opacity: 0.15 }} />
                      </div>
                    )}

                    {/* Light reflection on cover */}
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      background: 'linear-gradient(135deg, rgba(255,255,255,0.08) 0%, transparent 50%, rgba(0,0,0,0.1) 100%)',
                      pointerEvents: 'none',
                    }} />
                  </div>

                  {/* Book spine */}
                  <div style={{
                    position: 'absolute',
                    width: `${SPINE_WIDTH}px`,
                    height: '100%',
                    left: 0,
                    backfaceVisibility: 'hidden',
                    transformOrigin: 'left center',
                    transform: `rotateY(-90deg)`,
                    borderRadius: '4px 0 0 4px',
                    overflow: 'hidden',
                    background: 'linear-gradient(180deg, #3a2820 0%, #2a1a14 40%, #1e1210 100%)',
                    boxShadow: 'inset -2px 0 8px rgba(0,0,0,0.4), inset 1px 0 0 rgba(255,255,255,0.05)',
                  }}>
                    {/* Spine text */}
                    <div style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      writingMode: 'vertical-rl',
                      textOrientation: 'mixed',
                      color: 'rgba(255,255,255,0.5)',
                      fontSize: '9px',
                      fontWeight: 600,
                      letterSpacing: '1px',
                      padding: '12px 0',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
                      {book.title}
                    </div>

                    {/* Spine grooves */}
                    <div style={{
                      position: 'absolute',
                      top: '8px', left: '2px', right: '2px',
                      height: '1px',
                      background: 'rgba(255,255,255,0.08)',
                    }} />
                    <div style={{
                      position: 'absolute',
                      bottom: '8px', left: '2px', right: '2px',
                      height: '1px',
                      background: 'rgba(255,255,255,0.08)',
                    }} />
                  </div>

                  {/* Book top edge */}
                  <div style={{
                    position: 'absolute',
                    width: '100%',
                    height: `${SPINE_WIDTH}px`,
                    top: 0,
                    transformOrigin: 'top center',
                    transform: `rotateX(90deg)`,
                    background: 'linear-gradient(90deg, #ddd5c8 0%, #e8e0d4 50%, #ddd5c8 100%)',
                    borderRadius: '2px',
                  }} />

                  {/* Favorite button floating above center book */}
                  {isFront && (
                    <motion.button
                      initial={{ opacity: 0, scale: 0.5, y: 10 }}
                      animate={{
                        opacity: hoveredCenter ? 1 : 0,
                        scale: hoveredCenter ? 1 : 0.5,
                        y: hoveredCenter ? 0 : 10,
                      }}
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 25 }}
                      onClick={handleFavoriteClick}
                      style={{
                        position: 'absolute',
                        top: '-44px',
                        left: '50%',
                        marginLeft: '-18px',
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        border: '1px solid rgba(255,100,130,0.4)',
                        background: 'rgba(255,80,120,0.15)',
                        backdropFilter: 'blur(12px)',
                        WebkitBackdropFilter: 'blur(12px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: 'pointer',
                        color: '#ff6b8a',
                        boxShadow: '0 4px 16px rgba(255,80,120,0.25)',
                        pointerEvents: hoveredCenter ? 'auto' : 'none',
                        zIndex: 20,
                      }}
                    >
                      <Heart
                        size={16}
                        fill={favAnimating ? '#ff6b8a' : 'none'}
                        style={{ transition: 'fill 0.2s' }}
                      />
                    </motion.button>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>

        {/* Shelf surface */}
        <div style={{
          position: 'relative',
          width: '90%',
          maxWidth: '800px',
          height: '28px',
          background: 'linear-gradient(180deg, #3a2a20 0%, #2a1c15 60%, #1e1410 100%)',
          borderRadius: '2px 2px 6px 6px',
          boxShadow: `
            0 8px 32px rgba(0,0,0,0.5),
            0 2px 4px rgba(0,0,0,0.3),
            inset 0 1px 0 rgba(255,255,255,0.1),
            inset 0 -1px 0 rgba(0,0,0,0.3)
          `,
          zIndex: 5,
          flexShrink: 0,
        }}>
          {/* Shelf top highlight */}
          <div style={{
            position: 'absolute',
            top: 0,
            left: '10%',
            right: '10%',
            height: '1px',
            background: 'linear-gradient(90deg, transparent, rgba(255,220,180,0.2), transparent)',
          }} />
          {/* Shelf front face grain texture */}
          <div style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 'inherit',
            background: 'repeating-linear-gradient(90deg, transparent, transparent 40px, rgba(255,255,255,0.02) 40px, rgba(255,255,255,0.02) 80px)',
            pointerEvents: 'none',
          }} />
        </div>

        {/* Shelf bracket / support shadow */}
        <div style={{
          width: '85%',
          maxWidth: '760px',
          height: '6px',
          background: 'linear-gradient(180deg, rgba(0,0,0,0.3) 0%, transparent 100%)',
          borderRadius: '0 0 50% 50%',
          zIndex: 4,
          flexShrink: 0,
        }} />
      </div>

      {/* === Bottom section: Book info + Interactive controls === */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '16px',
        paddingTop: '20px',
        paddingBottom: '8px',
        width: '100%',
        maxWidth: '560px',
      }}>
        {/* Book info */}
        {centerBook && (
          <motion.div
            key={centerBook.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.05 }}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '5px',
              textAlign: 'center',
              maxWidth: '400px',
            }}
          >
            <h3 style={{
              fontSize: '17px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              margin: 0,
              fontFamily: '"Georgia", "Times New Roman", "Songti SC", "SimSun", serif',
              letterSpacing: '0.5px',
              lineHeight: 1.3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: '100%',
            }}>
              {centerBook.title}
            </h3>
            {centerBook.author && (
              <p style={{
                fontSize: '12px',
                color: 'var(--text-tertiary)',
                margin: 0,
                letterSpacing: '1.5px',
                textTransform: 'uppercase',
                fontWeight: 400,
              }}>
                {centerBook.author}
              </p>
            )}
            <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
              {centerBook.extension && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 500,
                  background: 'rgba(255,255,255,0.06)',
                  color: 'var(--text-secondary)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}>{centerBook.extension.toUpperCase()}</span>
              )}
              {centerBook.filesize && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 500,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-tertiary)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>{centerBook.filesizeString || formatFileSize(centerBook.filesize)}</span>
              )}
              {centerBook.language && (
                <span style={{
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 500,
                  background: 'rgba(255,255,255,0.04)',
                  color: 'var(--text-tertiary)',
                  border: '1px solid rgba(255,255,255,0.04)',
                }}>{centerBook.language.toUpperCase()}</span>
              )}
            </div>
          </motion.div>
        )}

        {/* Interactive control bar */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          width: '100%',
          marginTop: '4px',
        }}>
          {/* Left arrow */}
          <button
            onClick={() => onNavigate('left')}
            disabled={!canGoLeft}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.08)',
              background: canGoLeft ? 'rgba(255,255,255,0.05)' : 'transparent',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: canGoLeft ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              cursor: canGoLeft ? 'pointer' : 'default',
              transition: 'all 0.2s ease',
              opacity: canGoLeft ? 1 : 0.3,
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              if (canGoLeft) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = canGoLeft ? 'rgba(255,255,255,0.05)' : 'transparent';
              e.currentTarget.style.color = canGoLeft ? 'var(--text-secondary)' : 'var(--text-tertiary)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <ChevronLeft size={20} />
          </button>

          {/* Favorite button */}
          <motion.button
            whileHover={{ scale: 1.06 }}
            whileTap={{ scale: 0.95 }}
            onClick={handleFavoriteClick}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '10px 24px',
              borderRadius: '24px',
              border: '1px solid rgba(255,100,130,0.2)',
              background: 'rgba(255,80,120,0.08)',
              backdropFilter: 'blur(12px)',
              WebkitBackdropFilter: 'blur(12px)',
              color: '#ff6b8a',
              cursor: 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              letterSpacing: '0.5px',
              transition: 'all 0.25s ease',
              boxShadow: '0 2px 12px rgba(255,80,120,0.1)',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.background = 'rgba(255,80,120,0.15)';
              e.currentTarget.style.boxShadow = '0 4px 20px rgba(255,80,120,0.2)';
              e.currentTarget.style.borderColor = 'rgba(255,100,130,0.35)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = 'rgba(255,80,120,0.08)';
              e.currentTarget.style.boxShadow = '0 2px 12px rgba(255,80,120,0.1)';
              e.currentTarget.style.borderColor = 'rgba(255,100,130,0.2)';
            }}
          >
            <Heart
              size={15}
              fill={favAnimating ? '#ff6b8a' : 'none'}
              style={{ transition: 'fill 0.2s' }}
            />
            收藏
          </motion.button>

          {/* Right arrow */}
          <button
            onClick={() => onNavigate('right')}
            disabled={!canGoRight}
            style={{
              width: '40px',
              height: '40px',
              borderRadius: '50%',
              border: '1px solid rgba(255,255,255,0.08)',
              background: canGoRight ? 'rgba(255,255,255,0.05)' : 'transparent',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: canGoRight ? 'var(--text-secondary)' : 'var(--text-tertiary)',
              cursor: canGoRight ? 'pointer' : 'default',
              transition: 'all 0.2s ease',
              opacity: canGoRight ? 1 : 0.3,
              flexShrink: 0,
            }}
            onMouseEnter={e => {
              if (canGoRight) {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.transform = 'scale(1.05)';
              }
            }}
            onMouseLeave={e => {
              e.currentTarget.style.background = canGoRight ? 'rgba(255,255,255,0.05)' : 'transparent';
              e.currentTarget.style.color = canGoRight ? 'var(--text-secondary)' : 'var(--text-tertiary)';
              e.currentTarget.style.transform = 'scale(1)';
            }}
          >
            <ChevronRight size={20} />
          </button>
        </div>

        {/* Progress counter + hint */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: 'var(--text-tertiary)',
          fontSize: '11px',
          opacity: 0.5,
          letterSpacing: '0.5px',
        }}>
        </div>
      </div>
    </div>
  );
}
