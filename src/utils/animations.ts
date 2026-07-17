export const playDownloadCompleteSound = async () => {
    try {
        const soundFile = localStorage.getItem('olib-download-sound') || 'notification_message-notify-8-313753.mp3';
        if (soundFile === 'none') return;
        
        const audio = new Audio(`/src/assets/sounds/${soundFile}`);
        audio.volume = 0.5;
        await audio.play();
    } catch (err) {
        console.error("Failed to play download sound", err);
    }
};

export const animateDropToSidebar = (startRect: DOMRect, imageUrl: string, onComplete?: () => void) => {
    // 1. Find the target destination (Downloads link in Sidebar)
    const targetEl = document.getElementById('sidebar-downloads-link');
    if (!targetEl) {
        onComplete?.();
        return;
    }
    const targetRect = targetEl.getBoundingClientRect();

    // 2. Create the outer wrapper (for X-axis linear movement)
    const ghostWrapper = document.createElement('div');
    ghostWrapper.style.position = 'fixed';
    ghostWrapper.style.top = '0';
    ghostWrapper.style.left = '0';
    ghostWrapper.style.width = `${startRect.width}px`;
    ghostWrapper.style.height = `${startRect.height}px`;
    ghostWrapper.style.transform = `translate(${startRect.left}px, ${startRect.top}px)`;
    ghostWrapper.style.transition = 'transform 0.6s linear';
    ghostWrapper.style.pointerEvents = 'none';
    ghostWrapper.style.zIndex = '9999';

    // 3. Create the inner element (for Y-axis cubic-bezier movement and scaling)
    const ghostInner = document.createElement('div');
    ghostInner.style.width = '100%';
    ghostInner.style.height = '100%';
    ghostInner.style.transition = 'transform 0.6s cubic-bezier(0.5, 0, 1, 0.5), opacity 0.6s ease-in, border-radius 0.6s linear';
    ghostInner.style.backgroundImage = `url(${imageUrl})`;
    ghostInner.style.backgroundSize = 'cover';
    ghostInner.style.backgroundPosition = 'center';
    ghostInner.style.borderRadius = 'var(--radius-md)';
    ghostInner.style.boxShadow = '0 10px 25px rgba(0,0,0,0.3)';

    // Append into DOM
    ghostWrapper.appendChild(ghostInner);
    document.body.appendChild(ghostWrapper);

    // 4. Force reflow to ensure the transition will happen
    ghostWrapper.getBoundingClientRect();

    // 5. Trigger the animation to the target
    // Calculate exact center of the target element
    const targetX = targetRect.left + targetRect.width / 2 - startRect.width / 2;
    const targetY = targetRect.top + targetRect.height / 2 - startRect.height / 2;

    ghostWrapper.style.transform = `translate(${targetX}px, ${targetY}px)`;
    
    // Scale down drastically and fade out a bit at the end
    ghostInner.style.transform = 'scale(0.1)';
    ghostInner.style.opacity = '0.3';
    ghostInner.style.borderRadius = '50%';

    // 6. Cleanup after transition duration
    setTimeout(() => {
        if (document.body.contains(ghostWrapper)) {
            document.body.removeChild(ghostWrapper);
        }
        onComplete?.();
    }, 600); // 600ms matches the transition duration
};
