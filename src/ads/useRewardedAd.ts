import React from 'react';
import { requestRewardedAd, type AdPlacement } from './adProvider';

/**
 * Shared "watch a rewarded ad, then unlock" flow for the three rewarded
 * placements (idea reroll, mentor hint, extra dynasty generations). The
 * reward callback always runs once the (simulated) ad flow resolves,
 * whether or not an ad actually filled — see adProvider.ts's fallback rule.
 */
export function useRewardedAd(placement: AdPlacement) {
  const [loading, setLoading] = React.useState(false);

  const watch = React.useCallback(
    (onGranted: () => void) => {
      if (loading) return;
      setLoading(true);
      requestRewardedAd(placement).finally(() => {
        setLoading(false);
        onGranted();
      });
    },
    [placement, loading]
  );

  return { loading, watch };
}
