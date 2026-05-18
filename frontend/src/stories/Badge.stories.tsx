import type { Meta, StoryObj } from '@storybook/react';

type BadgeVariant = 'neutral' | 'brand' | 'success' | 'warning' | 'danger';

const badgeStyles: Record<BadgeVariant, { bg: string; fg: string }> = {
  neutral: { bg: 'bg-surface-sunken', fg: 'text-ink-secondary' },
  brand: { bg: 'bg-brand-muted', fg: 'text-brand-deep' },
  success: { bg: 'bg-status-success-subtle', fg: 'text-leaf-700' },
  warning: { bg: 'bg-status-warning-subtle', fg: 'text-clay-700' },
  danger: { bg: 'bg-status-danger-subtle', fg: 'text-earth-700' },
};

const Badge = ({ variant, label }: { variant: BadgeVariant; label: string }) => (
  <span className={`inline-flex items-center h-6 px-3 rounded-pill text-xs font-medium ${badgeStyles[variant].bg} ${badgeStyles[variant].fg}`}>
    {variant === 'brand' && <span className="mr-1 text-xs">🍃</span>}
    {label}
  </span>
);

const BadgeGallery = () => (
  <div className="flex flex-wrap gap-3 p-8">
    {(['neutral', 'brand', 'success', 'warning', 'danger'] as BadgeVariant[]).map((v) => (
      <Badge key={v} variant={v} label={v === 'brand' ? 'Verified+' : v} />
    ))}
  </div>
);

const meta: Meta = {
  title: '🧩 Components / Badge',
  component: BadgeGallery,
};
export default meta;
export const Gallery: StoryObj = { render: () => <BadgeGallery /> };
