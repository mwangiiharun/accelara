import { useEffect, useRef } from 'react';

export default function Speedometer({ value, maxValue = 100, unit = 'Mbps', label, color = '#0ea5e9', isRunning = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = Math.min(centerX, centerY) - 20;
    
    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw background arc
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, 0, false);
    ctx.lineWidth = 20;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim() || '#1e293b';
    ctx.stroke();

    // Calculate angle (0 to 180 degrees, mapped from 0 to maxValue)
    const percentage = Math.min(value / maxValue, 1);
    const angle = Math.PI * percentage;

    // Draw value arc (clockwise from left to right)
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, Math.PI, Math.PI - angle, false);
    ctx.lineWidth = 20;
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.stroke();

    // Draw tick marks
    const tickCount = 10;
    for (let i = 0; i <= tickCount; i++) {
      const tickAngle = Math.PI - (Math.PI * i / tickCount);
      const tickStartX = centerX + (radius - 10) * Math.cos(tickAngle);
      const tickStartY = centerY - (radius - 10) * Math.sin(tickAngle);
      const tickEndX = centerX + (radius + 10) * Math.cos(tickAngle);
      const tickEndY = centerY - (radius + 10) * Math.sin(tickAngle);
      
      ctx.beginPath();
      ctx.moveTo(tickStartX, tickStartY);
      ctx.lineTo(tickEndX, tickEndY);
      ctx.lineWidth = 2;
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#94a3b8';
      ctx.stroke();
    }

    // Draw value text - perfectly centered horizontally and vertically
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#f1f5f9';
    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Position value text in the center of the gauge arc (slightly above center to account for unit below)
    const valueTextY = centerY - 12;
    ctx.fillText(value.toFixed(1), centerX, valueTextY);

    // Draw unit text - perfectly centered below value
    ctx.font = '16px system-ui';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#cbd5e1';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // Position unit text directly below value text
    const unitTextY = centerY + 12;
    ctx.fillText(unit, centerX, unitTextY);

    // Draw label (Bytes per second) - positioned below the canvas to avoid touching widget
    // Label will be rendered outside the canvas in the component
  }, [value, maxValue, unit, label, color, isRunning]);

  // Determine if we should animate - only when test is running and value is 0
  const shouldAnimate = isRunning && (value === 0 || value < 0.1);

  return (
    <div className="flex flex-col items-center">
      <div className={`relative ${shouldAnimate ? 'animate-pulse' : ''}`}>
        <canvas
          ref={canvasRef}
          width={200}
          height={140}
          className={`block transition-all duration-500 ${shouldAnimate ? 'opacity-60' : 'opacity-100'}`}
          style={{
            transform: shouldAnimate ? 'scale(0.98)' : 'scale(1)',
            transition: 'opacity 0.5s ease, transform 0.5s ease',
          }}
        />
        {shouldAnimate && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <div 
              className="w-20 h-20 rounded-full animate-spin" 
              style={{ 
                border: `4px solid ${color}20`,
                borderTopColor: color,
                borderRightColor: color,
                opacity: 0.5,
              }} 
            />
          </div>
        )}
      </div>
      {label && (
        <p className={`text-xs theme-text-tertiary mt-2 text-center transition-all ${shouldAnimate ? 'animate-pulse' : ''}`}>
          {label}
        </p>
      )}
    </div>
  );
}

