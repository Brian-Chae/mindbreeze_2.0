import type { Preview } from '@storybook/react-vite';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    backgrounds: {
      default: 'oat',
      values: [
        { name: 'oat', value: '#F4F1E8' },
        { name: 'white', value: '#FFFFFF' },
        { name: 'dark', value: '#1A1D1A' },
      ],
    },
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    a11y: { test: 'todo' },
  },
};

export default preview;
