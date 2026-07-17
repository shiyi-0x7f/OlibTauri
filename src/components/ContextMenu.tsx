import React, { useEffect, useRef, useCallback } from 'react';

export interface ContextMenuItem {
    label: string;
    icon?: React.ReactNode;
    onClick: () => void | Promise<void>;
    danger?: boolean;
    disabled?: boolean;
    divider?: boolean;
}

interface ContextMenuProps {
    x: number;
    y: number;
    items: ContextMenuItem[];
    onClose: () => void;
}

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, items, onClose }) => {
    const menuRef = useRef<HTMLDivElement>(null);

    // Adjust position if menu overflows viewport
    const getAdjustedPosition = useCallback(() => {
        const menu = menuRef.current;
        if (!menu) return { left: x, top: y };

        const rect = menu.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        let left = x;
        let top = y;

        if (x + rect.width > vw - 8) left = vw - rect.width - 8;
        if (y + rect.height > vh - 8) top = vh - rect.height - 8;
        if (left < 8) left = 8;
        if (top < 8) top = 8;

        return { left, top };
    }, [x, y]);

    useEffect(() => {
        const menu = menuRef.current;
        if (menu) {
            const { left, top } = getAdjustedPosition();
            menu.style.left = `${left}px`;
            menu.style.top = `${top}px`;
            menu.style.opacity = '1';
            menu.style.transform = 'scale(1)';
        }
    }, [getAdjustedPosition]);

    // Close on click outside or Escape
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        const handleScroll = () => onClose();

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('keydown', handleKeyDown);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [onClose]);

    return (
        <div
            ref={menuRef}
            style={{
                position: 'fixed',
                left: x,
                top: y,
                zIndex: 1000,
                minWidth: '180px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-hover)',
                borderRadius: 'var(--radius-lg)',
                boxShadow: 'var(--shadow-lg)',
                padding: '6px',
                opacity: 0,
                transform: 'scale(0.95)',
                transformOrigin: 'top left',
                transition: 'opacity 120ms ease, transform 120ms ease',
                backdropFilter: 'blur(20px)',
            }}
        >
            {items.map((item, index) => {
                if (item.divider) {
                    return (
                        <div
                            key={index}
                            style={{
                                height: '1px',
                                background: 'var(--border)',
                                margin: '4px 8px',
                            }}
                        />
                    );
                }

                return (
                    <button
                        key={index}
                        disabled={item.disabled}
                        onClick={async () => {
                            await item.onClick();
                            onClose();
                        }}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '10px',
                            width: '100%',
                            padding: '8px 12px',
                            border: 'none',
                            borderRadius: 'var(--radius-sm)',
                            background: 'transparent',
                            color: item.danger ? 'var(--error)' : 'var(--text-primary)',
                            fontSize: '13px',
                            fontFamily: 'var(--font)',
                            cursor: item.disabled ? 'not-allowed' : 'pointer',
                            opacity: item.disabled ? 0.4 : 1,
                            transition: 'background var(--transition-fast)',
                            textAlign: 'left',
                            whiteSpace: 'nowrap',
                        }}
                        onMouseEnter={(e) => {
                            if (!item.disabled) {
                                e.currentTarget.style.background = item.danger
                                    ? 'rgba(239, 68, 68, 0.1)'
                                    : 'var(--bg-hover)';
                            }
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'transparent';
                        }}
                    >
                        {item.icon && (
                            <span style={{
                                display: 'flex',
                                alignItems: 'center',
                                width: '18px',
                                justifyContent: 'center',
                                flexShrink: 0,
                                opacity: 0.8,
                            }}>
                                {item.icon}
                            </span>
                        )}
                        <span>{item.label}</span>
                    </button>
                );
            })}
        </div>
    );
};

export default ContextMenu;
