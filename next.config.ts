import type { NextConfig } from 'next';
import { PHASE_PRODUCTION_BUILD } from 'next/constants';
import { parseServerEnv } from './src/env';

const config = (phase: string): NextConfig => {
  // A deployment with missing/invalid settings must FAIL AT BUILD TIME, so the previous good version
  // keeps serving customers instead of being replaced by a broken one.
  if (phase === PHASE_PRODUCTION_BUILD) parseServerEnv(process.env);
  return {
    reactStrictMode: true,
    poweredByHeader: false,
    images: { formats: ['image/webp'] },
  };
};

export default config;
