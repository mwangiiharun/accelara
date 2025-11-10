import { useEffect, useRef } from 'react';

export default function Speedometer({ value, maxValue = 100, unit = 'Mbps', label, color = '#0ea5e9' }) {
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

    // Draw value text
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim() || '#f1f5f9';
    ctx.font = 'bold 32px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(value.toFixed(1), centerX, centerY - 30);

    // Draw unit text
    ctx.font = '16px system-ui';
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-secondary').trim() || '#cbd5e1';
    ctx.fillText(unit, centerX, centerY - 5);

    // Draw label (Bytes per second) - moved lower
    if (label) {
      ctx.font = '12px system-ui';
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-tertiary').trim() || '#94a3b8';
      ctx.fillText(label, centerX, centerY + 35);
    }
  }, [value, maxValue, unit, label, color]);

  return (
    <div className="flex flex-col items-center">
      <canvas
        ref={canvasRef}
        width={200}
        height={140}
        className="block"
      />
    </div>
  );
}

