import type { Meta, StoryObj } from '@storybook/react';
import LoginPage from '../pages/LoginPage';

const meta: Meta<typeof LoginPage> = {
  title: '🧩 Components / Login',
  component: LoginPage,
  parameters: { layout: 'fullscreen' },
};
export default meta;

export const Default: StoryObj = { render: () => <LoginPage /> };
