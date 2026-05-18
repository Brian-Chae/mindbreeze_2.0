import type { Meta, StoryObj } from '@storybook/react';

const BreathCircleDemo = ({ size = 'md' }: { size?: 'sm' | 'md' }) => {
  const dims = size === 'sm' ? { w: 48, h: 48 } : { w: 80, h: 80 };
  return (
    <div className="flex items-center justify-center p-12">
      <div className="breath-circle" style={{ width: dims.w, height: dims.h } as React.CSSProperties}>
        <div className="breath-ring breath-ring--outer" />
        <div className="breath-ring breath-ring--middle" />
        <div className="breath-ring breath-ring--inner" />
      </div>
    </div>
  );
};

const meta: Meta<typeof BreathCircleDemo> = {
  title: '🧩 Components / Breath Circle',
  component: BreathCircleDemo,
};
export default meta;

export const Default: StoryObj = { render: () => <BreathCircleDemo /> };
export const Small: StoryObj = { render: () => <BreathCircleDemo size="sm" /> };
