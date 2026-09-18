interface InstanceIconProps {
  icon?: string;
  className?: string;
}

export function InstanceIcon({ icon, className }: InstanceIconProps) {
  if (icon && icon.startsWith('data:image/')) {
    return <img src={icon} alt="" className="w-full h-full object-cover" draggable={false} />;
  }
  return <span className={className}>{icon || '⛏️'}</span>;
}