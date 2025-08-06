import MaterialIcons from '@expo/vector-icons/MaterialIcons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, Text, StyleSheet, TouchableOpacity, Linking, Pressable, Platform } from 'react-native';
import Toast from 'react-native-toast-message';

import type { Credential } from '@/utils/dist/shared/models/vault';
import emitter from '@/utils/EventEmitter';

import { useColors } from '@/hooks/useColorScheme';

import { CredentialIcon } from '@/components/credentials/CredentialIcon';
import { AliasDetails } from '@/components/credentials/details/AliasDetails';
import { AttachmentSection } from '@/components/credentials/details/AttachmentSection';
import { EmailPreview } from '@/components/credentials/details/EmailPreview';
import { LoginCredentials } from '@/components/credentials/details/LoginCredentials';
import { NotesSection } from '@/components/credentials/details/NotesSection';
import { TotpSection } from '@/components/credentials/details/TotpSection';
import { ThemedContainer } from '@/components/themed/ThemedContainer';
import { ThemedScrollView } from '@/components/themed/ThemedScrollView';
import { ThemedText } from '@/components/themed/ThemedText';
import { ThemedView } from '@/components/themed/ThemedView';
import { useDb } from '@/context/DbContext';

/**
 * Credential details screen.
 */
export default function CredentialDetailsScreen() : React.ReactNode {
  const { id } = useLocalSearchParams();
  const [credential, setCredential] = useState<Credential | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dbContext = useDb();
  const navigation = useNavigation();
  const colors = useColors();
  const router = useRouter();

  /**
   * Handle the edit button press.
   */
  const handleEdit = useCallback(() : void => {
    router.push(`/(tabs)/credentials/add-edit?id=${id}`);
  }, [id, router]);

  // Set header buttons
  useEffect(() => {
    navigation.setOptions({
      /**
       * Header right button.
       */
      headerRight: () => (
        <View style={styles.headerRightContainer}>
          {Platform.OS === 'android' ? (
            <Pressable
              onPressIn={handleEdit}
              android_ripple={{ color: 'lightgray' }}
              pressRetentionOffset={100}
              hitSlop={100}
              style={styles.headerRightButton}
            >
              <MaterialIcons
                name="edit"
                size={24}
                color={colors.primary}
              />
            </Pressable>
          ) : (
            <TouchableOpacity
              onPress={handleEdit}
              style={styles.headerRightButton}
            >
              <MaterialIcons
                name="edit"
                size={22}
                color={colors.primary}
              />
            </TouchableOpacity>
          )}
        </View>
      ),
    });
  }, [navigation, credential, handleEdit, colors.primary]);

  useEffect(() => {
    /**
     * Load the credential.
     */
    const loadCredential = async () : Promise<void> => {
      if (!dbContext.dbAvailable || !id) {
        return;
      }

      try {
        const cred = await dbContext.sqliteClient!.getCredentialById(id as string);
        setCredential(cred);
      } catch (err) {
        console.error('Error loading credential:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadCredential();

    // Add listener for credential changes
    const credentialChangedSub = emitter.addListener('credentialChanged', async (changedId: string) => {
      if (changedId === id) {
        await loadCredential();
      }
    });

    return () : void => {
      credentialChangedSub.remove();
      Toast.hide();
    };
  }, [id, dbContext.dbAvailable, dbContext.sqliteClient]);

  if (isLoading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (!credential) {
    return null;
  }

  return (
    <ThemedContainer>
      <ThemedScrollView>
        <ThemedView style={styles.header}>
          <CredentialIcon logo={credential.Logo} style={styles.logo} />
          <View style={styles.headerText}>
            <ThemedText type="title" style={styles.serviceName}>
              {credential.ServiceName}
            </ThemedText>
            {credential.ServiceUrl && (
              <TouchableOpacity onPress={() => Linking.openURL(credential.ServiceUrl!)}>
                <Text style={[styles.serviceUrl, { color: colors.primary }]}>
                  {credential.ServiceUrl}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </ThemedView>
        <EmailPreview email={credential.Alias.Email} />
        <TotpSection credential={credential} />
        <LoginCredentials credential={credential} />
        <AliasDetails credential={credential} />
        <NotesSection credential={credential} />
        <AttachmentSection credential={credential} />
      </ThemedScrollView>
    </ThemedContainer>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  headerRightButton: {
    padding: 10,
  },
  headerRightContainer: {
    flexDirection: 'row',
  },
  headerText: {
    flex: 1,
  },
  loadingContainer: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  logo: {
    borderRadius: 4,
    height: 48,
    width: 48,
  },
  serviceName: {
    fontSize: 24,
    fontWeight: 'bold',
  },
  serviceUrl: {
    fontSize: 14,
  },
});