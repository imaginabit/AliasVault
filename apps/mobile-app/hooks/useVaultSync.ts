import { useCallback } from 'react';

import { AppInfo } from '@/utils/AppInfo';
import type { VaultResponse } from '@/utils/dist/shared/models/webapi';

import { useTranslation } from '@/hooks/useTranslation';

import { useAuth } from '@/context/AuthContext';
import { useDb } from '@/context/DbContext';
import { useWebApi } from '@/context/WebApiContext';
import NativeVaultManager from '@/specs/NativeVaultManager';

/**
 * Utility function to ensure a minimum time has elapsed for an operation
 */
const withMinimumDelay = async <T>(
  operation: () => Promise<T>,
  minDelayMs: number,
  enableDelay: boolean = true
): Promise<T> => {
  if (!enableDelay) {
    // If delay is disabled, return the result immediately.
    return operation();
  }

  const startTime = Date.now();
  const result = await operation();
  const elapsedTime = Date.now() - startTime;

  if (elapsedTime < minDelayMs) {
    await new Promise(resolve => setTimeout(resolve, minDelayMs - elapsedTime));
  }

  return result;
};

type VaultSyncOptions = {
  initialSync?: boolean;
  onSuccess?: (hasNewVault: boolean) => void;
  onError?: (error: string) => void;
  onStatus?: (message: string) => void;
  onOffline?: () => void;
  onUpgradeRequired?: () => void;
}

/**
 * Hook to sync the vault with the server.
 */
export const useVaultSync = () : {
  syncVault: (options?: VaultSyncOptions) => Promise<boolean>;
} => {
  const { t } = useTranslation();
  const authContext = useAuth();
  const dbContext = useDb();
  const webApi = useWebApi();

  const syncVault = useCallback(async (options: VaultSyncOptions = {}) => {
    const { initialSync = false, onSuccess, onError, onStatus, onOffline, onUpgradeRequired } = options;

    // For the initial sync, we add an artifical delay to various steps which makes it feel more fluid.
    const enableDelay = initialSync;

    try {
      const { isLoggedIn } = await authContext.initializeAuth();

      if (!isLoggedIn) {
        // Not authenticated, return false immediately
        return false;
      }

      // Check app status and vault revision
      onStatus?.(t('vault.checkingVaultUpdates'));
      const statusResponse = await withMinimumDelay(() => webApi.getStatus(), 300, enableDelay);

      if (statusResponse.serverVersion === '0.0.0') {
        // Server is not available, go into offline mode
        onOffline?.();
        return false;
      }

      if (!statusResponse.clientVersionSupported) {
        const statusError = t('vault.errors.versionNotSupported');
        onError?.(statusError);
        return false;
      }

      if (!AppInfo.isServerVersionSupported(statusResponse.serverVersion)) {
        const statusError = t('vault.errors.serverNeedsUpdate');
        onError?.(statusError);
        return false;
      }

      // If we get here, it means we have a valid connection to the server.
      authContext.setOfflineMode(false);

      // Compare vault revisions
      const vaultMetadata = await dbContext.getVaultMetadata();
      const vaultRevisionNumber = vaultMetadata?.vaultRevisionNumber ?? 0;

      if (statusResponse.vaultRevision > vaultRevisionNumber) {
        onStatus?.(t('vault.syncingUpdatedVault'));
        const vaultResponseJson = await withMinimumDelay(() => webApi.get<VaultResponse>('Vault'), 1000, enableDelay);

        const vaultError = webApi.validateVaultResponse(vaultResponseJson as VaultResponse);
        if (vaultError) {
          // Only logout if it's an authentication error, not a network error
          if (vaultError.includes('authentication') || vaultError.includes('unauthorized')) {
            await webApi.logout(vaultError);
            onError?.(vaultError);
            return false;
          }

          // For other errors, go into offline mode
          authContext.setOfflineMode(true);
          return true;
        }

        try {
          await dbContext.initializeDatabase(vaultResponseJson as VaultResponse);

          // Check if the current vault version is known and up to date, if not known trigger an exception, if not up to date redirect to the upgrade page.
          if (await NativeVaultManager.isVaultUnlocked() && await dbContext.hasPendingMigrations()) {
            onUpgradeRequired?.();
            return false;
          }

          onSuccess?.(true);
          return true;
        } catch {
          // Vault could not be decrypted, throw an error
          throw new Error(t('vault.errors.vaultDecryptFailed'));
        }
      }

      // Check if the vault is up to date, if not, redirect to the upgrade page.
      if (await NativeVaultManager.isVaultUnlocked() && await dbContext.hasPendingMigrations()) {
        onUpgradeRequired?.();
        return false;
      }

      await withMinimumDelay(() => Promise.resolve(onSuccess?.(false)), 300, enableDelay);
      return false;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : t('vault.errors.unknownErrorDuringSync');
      console.error('Vault sync error:', err);

      // Check if it's a network error
      if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
        authContext.setOfflineMode(true);
        return true;
      }

      onError?.(errorMessage);
      return false;
    }
  }, [authContext, dbContext, webApi, t]);

  return { syncVault };
};