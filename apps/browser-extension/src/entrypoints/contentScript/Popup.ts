import { sendMessage } from 'webext-bridge/content-script';

import { filterCredentials } from '@/entrypoints/contentScript/Filter';
import { fillCredential } from '@/entrypoints/contentScript/Form';

import { DISABLED_SITES_KEY, TEMPORARY_DISABLED_SITES_KEY, GLOBAL_AUTOFILL_POPUP_ENABLED_KEY, VAULT_LOCKED_DISMISS_UNTIL_KEY, LAST_CUSTOM_EMAIL_KEY, LAST_CUSTOM_USERNAME_KEY } from '@/utils/Constants';
import { CreateIdentityGenerator } from '@/utils/dist/shared/identity-generator';
import type { Credential } from '@/utils/dist/shared/models/vault';
import { CreatePasswordGenerator, PasswordGenerator, PasswordSettings } from '@/utils/dist/shared/password-generator';
import { FormDetector } from '@/utils/formDetector/FormDetector';
import { SqliteClient } from '@/utils/SqliteClient';
import { CredentialsResponse } from '@/utils/types/messaging/CredentialsResponse';
import { IdentitySettingsResponse } from '@/utils/types/messaging/IdentitySettingsResponse';
import { PasswordSettingsResponse } from '@/utils/types/messaging/PasswordSettingsResponse';
import { StringResponse } from '@/utils/types/messaging/StringResponse';

import { t } from '@/i18n/StandaloneI18n';

import { storage } from '#imports';

/**
 * WeakMap to store event listeners for popup containers
 */
let popupListeners = new WeakMap<HTMLElement, EventListener>();

/**
 * Open (or refresh) the autofill popup including check if vault is locked.
 */
export function openAutofillPopup(input: HTMLInputElement, container: HTMLElement) : void {
  createLoadingPopup(input, '', container);

  /**
   * Handle the Enter key.
   */
  const handleEnterKey = (e: KeyboardEvent) : void => {
    if (e.key === 'Enter') {
      removeExistingPopup(container);
      // Remove the event listener to clean up
      document.body.removeEventListener('keydown', handleEnterKey);
    }
  };

  document.addEventListener('keydown', handleEnterKey);

  (async () : Promise<void> => {
    const response = await sendMessage('GET_CREDENTIALS', { }, 'background') as CredentialsResponse;

    if (response.success) {
      await createAutofillPopup(input, response.credentials, container);
    } else {
      await createVaultLockedPopup(input, container);
    }
  })();
}

/**
 * Create basic popup with default style.
 */
export function createBasePopup(input: HTMLInputElement, rootContainer: HTMLElement) : HTMLElement {
  // Remove existing popup and its event listeners
  removeExistingPopup(rootContainer);

  const popup = document.createElement('div');
  popup.id = 'aliasvault-credential-popup';
  popup.className = 'av-popup';

  // Get position of the input field relative to the viewport
  const inputRect = input.getBoundingClientRect();

  // Get position of the root container relative to the viewport
  const rootContainerRect = rootContainer.getBoundingClientRect();

  /*
   * Calculate the position relative to the root container
   * This accounts for any offset the shadow root might have in the page
   */
  const relativeTop = inputRect.bottom - rootContainerRect.top;
  const relativeLeft = inputRect.left - rootContainerRect.left;

  // Set the position
  popup.style.position = 'absolute';
  popup.style.top = `${relativeTop}px`;
  popup.style.left = `${relativeLeft}px`;

  // Append popup to the root container
  rootContainer.appendChild(popup);

  return popup;
}

/**
 * Create a loading popup.
 */
export function createLoadingPopup(input: HTMLInputElement, message: string, rootContainer: HTMLElement) : HTMLElement {
  /**
   * Get the loading wrapper HTML.
   */
  const getLoadingHtml = (message: string): string => `
    <div class="av-loading-container">
      <div class="av-loading-spinner"></div>
      <span class="av-loading-text">${message}</span>
    </div>
  `;

  const popup = createBasePopup(input, rootContainer);
  popup.innerHTML = getLoadingHtml(message);

  rootContainer.appendChild(popup);
  return popup;
}

/**
 * Update the credential list content in the popup.
 *
 * @param credentials - The credentials to display.
 * @param credentialList - The credential list element.
 * @param input - The input element that triggered the popup. Required when filling credentials to know which form to fill.
 */
export function updatePopupContent(credentials: Credential[], credentialList: HTMLElement | null, input: HTMLInputElement, rootContainer: HTMLElement, noMatchesText?: string) : void {
  if (!credentialList) {
    credentialList = document.getElementById('aliasvault-credential-list') as HTMLElement;
  }

  if (!credentialList) {
    return;
  }

  // Clear existing content
  credentialList.innerHTML = '';

  // Add credentials using the shared function
  const credentialElements = createCredentialList(credentials, input, rootContainer, noMatchesText);
  credentialElements.forEach(element => credentialList.appendChild(element));
}

/**
 * Remove existing popup (if any exists).
 */
export function removeExistingPopup(container: HTMLElement) : void {
  const existingInContainer = container.querySelector('#aliasvault-credential-popup');

  if (existingInContainer) {
    // Remove event listeners before removing the element
    if (popupListeners && popupListeners.has(container)) {
      const listener = popupListeners.get(container);
      if (listener) {
        container.removeEventListener('mousedown', listener);
        popupListeners.delete(container);
      }
    }

    existingInContainer.remove();
  }
}

/**
 * Create auto-fill popup
 */
export async function createAutofillPopup(input: HTMLInputElement, credentials: Credential[] | undefined, rootContainer: HTMLElement) : Promise<void> {
  // Get all translations first
  const newText = await t('content.new');
  const searchPlaceholder = await t('content.searchVault');
  const hideFor1HourText = await t('content.hideFor1Hour');
  const hidePermanentlyText = await t('content.hidePermanently');
  const noMatchesText = await t('content.noMatchesFound');
  const creatingText = await t('content.creatingNewAlias');
  const failedText = await t('content.failedToCreateIdentity');

  // Disable browser's native autocomplete to avoid conflicts with AliasVault's autocomplete.
  input.setAttribute('autocomplete', 'false');
  const popup = createBasePopup(input, rootContainer);

  // Create credential list container with ID
  const credentialList = document.createElement('div');
  credentialList.id = 'aliasvault-credential-list';
  credentialList.className = 'av-credential-list';
  popup.appendChild(credentialList);

  // Add initial credentials
  if (!credentials) {
    credentials = [];
  }

  const filteredCredentials = filterCredentials(
    credentials,
    window.location.href,
    document.title
  );

  updatePopupContent(filteredCredentials, credentialList, input, rootContainer, noMatchesText);

  // Add divider
  const divider = document.createElement('div');
  divider.className = 'av-divider';
  popup.appendChild(divider);

  // Add action buttons container
  const actionContainer = document.createElement('div');
  actionContainer.className = 'av-action-container';

  // Create New button
  const createButton = document.createElement('button');
  createButton.className = 'av-button av-button-primary';
  createButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
    </svg>
    ${newText}
  `;

  /**
   * Handle create button click
   */
  const handleCreateClick = async (e: Event) : Promise<void> => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    const suggestedNames = FormDetector.getSuggestedServiceName(document, window.location);
    const result = await createAliasCreationPopup(suggestedNames, rootContainer);

    if (!result) {
      // User cancelled
      return;
    }

    const loadingPopup = createLoadingPopup(input, creatingText, rootContainer);

    try {
      // Sync with api to ensure we have the latest vault.
      await sendMessage('SYNC_VAULT', {}, 'background');

      // Retrieve default email domain from background
      const response = await sendMessage('GET_DEFAULT_EMAIL_DOMAIN', {}, 'background') as StringResponse;
      const domain = response.value;

      let credential: Credential;

      if (result.isCustomCredential) {
        // Create custom credential with information provided by user in popup.
        const faviconBytes = await getFaviconBytes(document);
        credential = {
          Id: '',
          ServiceName: result.serviceName ?? '',
          ServiceUrl: getValidServiceUrl(),
          Logo: faviconBytes ?? undefined,
          Username: result.customUsername,
          Password: result.customPassword ?? '',
          Alias: {
            NickName: result.customUsername ?? '',
            // TODO: once birthdate is made nullable in datamodel refactor, remove this.
            BirthDate: '0001-01-01 00:00:00',
            Email: result.customEmail ?? ''
          }
        };
      } else {
        // Generate new random identity using identity generator.
        const identitySettings = await sendMessage('GET_DEFAULT_IDENTITY_SETTINGS', {}, 'background') as IdentitySettingsResponse;
        const identityGenerator = CreateIdentityGenerator(identitySettings.settings?.language ?? 'en');
        const identity = identityGenerator.generateRandomIdentity(identitySettings.settings?.gender);

        // Get password settings from background
        const passwordSettingsResponse = await sendMessage('GET_PASSWORD_SETTINGS', {}, 'background') as PasswordSettingsResponse;

        // Initialize password generator with the retrieved settings
        const passwordGenerator = CreatePasswordGenerator(passwordSettingsResponse.settings ?? {
          Length: 12,
          UseLowercase: true,
          UseUppercase: true,
          UseNumbers: true,
          UseSpecialChars: true,
          UseNonAmbiguousChars: true
        });
        const password = passwordGenerator.generateRandomPassword();

        // Extract favicon from page and get the bytes
        const faviconBytes = await getFaviconBytes(document);

        credential = {
          Id: '',
          ServiceName: result.serviceName ?? '',
          ServiceUrl: getValidServiceUrl(),
          Logo: faviconBytes ?? undefined,
          Username: identity.nickName,
          Password: password,
          Alias: {
            FirstName: identity.firstName,
            LastName: identity.lastName,
            NickName: identity.nickName,
            BirthDate: identity.birthDate.toISOString(),
            Gender: identity.gender,
            Email: `${identity.emailPrefix}@${domain}`
          }
        };
      }

      // Create identity in background.
      await sendMessage('CREATE_IDENTITY', {
        credential: JSON.parse(JSON.stringify(credential))
      }, 'background');

      // Close popup.
      removeExistingPopup(rootContainer);

      // Fill the form with the new identity immediately.
      fillCredential(credential, input);
    } catch (error) {
      console.error('Error creating identity:', error);
      loadingPopup.innerHTML = `
        <div style="padding: 16px; color: #ef4444;">
          ${failedText}
        </div>
      `;
      setTimeout(() => {
        removeExistingPopup(rootContainer);
      }, 2000);
    }
  };

  // Add click listener with capture and prevent removal.
  addReliableClickHandler(createButton, handleCreateClick);

  // Create search input.
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.dataset.avDisable = 'true';
  searchInput.placeholder = searchPlaceholder;
  searchInput.className = 'av-search-input';

  // Handle search input.
  let searchTimeout: NodeJS.Timeout | null = null;
  searchInput.addEventListener('input', () => {
    handleSearchInput(searchInput, credentials, rootContainer, searchTimeout, credentialList, input, noMatchesText);
  });

  // Close button
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close';
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  `;

  /**
   * Handle close button click
   */
  const handleCloseClick = (e: Event): void => {
    e.stopPropagation();
    const rect = closeButton.getBoundingClientRect();
    const contextMenu = document.createElement('div');
    contextMenu.className = 'av-context-menu';
    contextMenu.style.position = 'fixed';
    contextMenu.style.left = `${rect.left}px`;
    contextMenu.style.top = `${rect.bottom + 4}px`;
    contextMenu.innerHTML = `
      <button class="av-context-menu-item" data-action="temporary">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hideFor1HourText}
      </button>
      <button class="av-context-menu-item" data-action="permanent">
        <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M6 18L18 6M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        ${hidePermanentlyText}
      </button>
    `;

    // Remove any existing context menu
    const existingMenu = document.querySelector('.av-context-menu');
    if (existingMenu) {
      existingMenu.remove();
    }

    // Add the new context menu
    popup.appendChild(contextMenu);

    /**
     * Handle clicks on context menu items
     * @param e - The click event
     */
    const handleContextMenuClick = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      const target = e.target as HTMLElement;
      const menuItem = target.closest('.av-context-menu-item') as HTMLElement;
      if (!menuItem) {
        // Clicked outside the menu, close everything
        contextMenu.remove();
        removeExistingPopup(rootContainer);
        document.removeEventListener('click', handleContextMenuClick);
        return;
      }

      const action = menuItem.dataset.action;
      if (action === 'temporary') {
        disableAutoShowPopup(true);
      } else if (action === 'permanent') {
        disableAutoShowPopup(false);
      }
      contextMenu.remove();
      removeExistingPopup(rootContainer);
      document.removeEventListener('click', handleContextMenuClick);
    };

    // Add click listener to handle menu item clicks
    addReliableClickHandler(contextMenu, handleContextMenuClick);
  };

  // Add click handlers
  addReliableClickHandler(closeButton, (e: Event) => {
    handleCloseClick(e);
  });

  actionContainer.appendChild(searchInput);
  actionContainer.appendChild(createButton);
  actionContainer.appendChild(closeButton);
  popup.appendChild(actionContainer);

  /**
   * Handle clicking outside the popup.
   */
  const handleClickOutside = (event: MouseEvent) : void => {
    const popup = rootContainer.querySelector('#aliasvault-credential-popup');
    const target = event.target as Node;
    const targetElement = event.target as HTMLElement;
    // If popup doesn't exist, remove the listener
    if (!popup) {
      document.removeEventListener('mousedown', handleClickOutside);
      return;
    }

    // Check if the click is outside the popup and outside the shadow UI
    if (popup && !popup.contains(target) && !input.contains(target) && targetElement.tagName !== 'ALIASVAULT-UI') {
      removeExistingPopup(rootContainer);
    }
  };

  // Add the event listener for clicking outside
  document.addEventListener('mousedown', handleClickOutside);
  rootContainer.appendChild(popup);
}

/**
 * Create vault locked popup.
 */
export async function createVaultLockedPopup(input: HTMLInputElement, rootContainer: HTMLElement): Promise<void> {
  /**
   * Handle unlock click.
   */
  const handleUnlockClick = () : void => {
    sendMessage('OPEN_POPUP', {}, 'background');
    removeExistingPopup(rootContainer);
  }

  const popup = createBasePopup(input, rootContainer);
  popup.classList.add('av-vault-locked');

  // Create container for message and button
  const container = document.createElement('div');
  container.className = 'av-vault-locked-container';

  // Make the entire container clickable
  addReliableClickHandler(container, handleUnlockClick);
  container.style.cursor = 'pointer';

  // Add message
  const messageElement = document.createElement('div');
  messageElement.className = 'av-vault-locked-message';
  messageElement.textContent = await t('content.vaultLocked');
  container.appendChild(messageElement);

  // Add unlock button with SVG icon
  const button = document.createElement('button');
  button.title = 'Unlock AliasVault';
  button.className = 'av-vault-locked-button';
  button.innerHTML = `
    <svg class="av-icon-lock" viewBox="0 0 24 24">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
    </svg>
  `;
  container.appendChild(button);

  // Add the container to the popup
  popup.appendChild(container);

  // Add close button as a separate element positioned to the right
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close av-vault-locked-close';
  closeButton.title = 'Dismiss popup';
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  // Position the close button to the right of the container
  closeButton.style.position = 'absolute';
  closeButton.style.right = '8px';
  closeButton.style.top = '50%';
  closeButton.style.transform = 'translateY(-50%)';

  // Handle close button click
  addReliableClickHandler(closeButton, async (e) => {
    e.stopPropagation(); // Prevent opening the unlock popup
    await dismissVaultLockedPopup();
    removeExistingPopup(rootContainer);
  });

  popup.appendChild(closeButton);

  /**
   * Add event listener to document to close popup when clicking outside.
   */
  const handleClickOutside = (event: MouseEvent): void => {
    const target = event.target as Node;
    const targetElement = event.target as HTMLElement;

    // Check if the click is outside the popup and outside the shadow UI
    if (popup && !popup.contains(target) && !input.contains(target) && targetElement.tagName !== 'ALIASVAULT-UI') {
      removeExistingPopup(rootContainer);
      document.removeEventListener('mousedown', handleClickOutside);
    }
  };

  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 100);

  rootContainer.appendChild(popup);
}

/**
 * Handle popup search input by filtering credentials based on the search term.
 */
function handleSearchInput(searchInput: HTMLInputElement, credentials: Credential[], rootContainer: HTMLElement, searchTimeout: NodeJS.Timeout | null, credentialList: HTMLElement | null, input: HTMLInputElement, noMatchesText?: string) : void {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  const searchTerm = searchInput.value.toLowerCase();

  // Ensure we have unique credentials
  const uniqueCredentials = Array.from(new Map(credentials.map(cred => [cred.Id, cred])).values());
  let filteredCredentials;

  if (searchTerm === '') {
    // If search is empty, use original URL-based filtering
    filteredCredentials = filterCredentials(
      uniqueCredentials,
      window.location.href,
      document.title
    ).sort((a, b) => {
      // First compare by service name
      const serviceNameComparison = (a.ServiceName ?? '').localeCompare(b.ServiceName ?? '');
      if (serviceNameComparison !== 0) {
        return serviceNameComparison;
      }

      // If service names are equal, compare by username/nickname
      return (a.Username ?? '').localeCompare(b.Username ?? '');
    });
  } else {
    // Otherwise filter based on search term
    filteredCredentials = uniqueCredentials.filter(cred => {
      const searchableFields = [
        cred.ServiceName?.toLowerCase(),
        cred.Username?.toLowerCase(),
        cred.Alias?.Email?.toLowerCase(),
        cred.ServiceUrl?.toLowerCase()
      ];
      return searchableFields.some(field => field?.includes(searchTerm));
    }).sort((a, b) => {
      // First compare by service name
      const serviceNameComparison = (a.ServiceName ?? '').localeCompare(b.ServiceName ?? '');
      if (serviceNameComparison !== 0) {
        return serviceNameComparison;
      }

      // If service names are equal, compare by username/nickname
      return (a.Username ?? '').localeCompare(b.Username ?? '');
    });
  }

  // Update popup content with filtered results
  updatePopupContent(filteredCredentials, credentialList, input, rootContainer, noMatchesText);
}

/**
 * Create credential list content for popup
 *
 * @param credentials - The credentials to display.
 * @param input - The input element that triggered the popup. Required when filling credentials to know which form to fill.
 */
function createCredentialList(credentials: Credential[], input: HTMLInputElement, rootContainer: HTMLElement, noMatchesText?: string): HTMLElement[] {
  const elements: HTMLElement[] = [];

  if (credentials.length > 0) {
    credentials.forEach(cred => {
      const item = document.createElement('div');
      item.className = 'av-credential-item';

      // Create container for credential info (logo + username)
      const credentialInfo = document.createElement('div');
      credentialInfo.className = 'av-credential-info';

      const imgElement = document.createElement('img');
      imgElement.className = 'av-credential-logo';
      imgElement.src = SqliteClient.imgSrcFromBytes(cred.Logo);

      credentialInfo.appendChild(imgElement);
      const credTextContainer = document.createElement('div');
      credTextContainer.className = 'av-credential-text';

      // Service name (primary text)
      const serviceName = document.createElement('div');
      serviceName.className = 'av-service-name';
      serviceName.textContent = cred.ServiceName;

      // Details container (secondary text)
      const detailsContainer = document.createElement('div');
      detailsContainer.className = 'av-service-details';

      // Combine full name (if available) and username or email
      const details = [];
      if (cred.Alias?.FirstName && cred.Alias?.LastName) {
        details.push(`${cred.Alias.FirstName} ${cred.Alias.LastName}`);
      }
      if (cred.Username) {
        details.push(cred.Username);
      } else if (cred.Alias?.Email) {
        details.push(cred.Alias.Email);
      }
      detailsContainer.textContent = details.join(' · ');

      credTextContainer.appendChild(serviceName);
      credTextContainer.appendChild(detailsContainer);
      credentialInfo.appendChild(credTextContainer);

      // Add popout icon
      const popoutIcon = document.createElement('div');
      popoutIcon.className = 'av-popout-icon';
      popoutIcon.innerHTML = `
          <svg class="av-icon" viewBox="0 0 24 24">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
        `;

      // Handle popout click
      addReliableClickHandler(popoutIcon, (e) => {
        e.stopPropagation(); // Prevent credential fill
        sendMessage('OPEN_POPUP_WITH_CREDENTIAL', { credentialId: cred.Id }, 'background');
        removeExistingPopup(rootContainer);
      });

      item.appendChild(credentialInfo);
      item.appendChild(popoutIcon);

      // Update click handler to only trigger on credentialInfo
      addReliableClickHandler(credentialInfo, () => {
        fillCredential(cred, input);
        removeExistingPopup(rootContainer);
      });

      elements.push(item);
    });
  } else {
    const noMatches = document.createElement('div');
    noMatches.className = 'av-no-matches';
    noMatches.textContent = noMatchesText || 'No matches found';
    elements.push(noMatches);
  }

  return elements;
}

/**
 * Check if auto-popup is disabled for current site
 */
export async function isAutoShowPopupEnabled(): Promise<boolean> {
  const disabledSites = await storage.getItem(DISABLED_SITES_KEY) as string[] ?? [];
  const temporaryDisabledSites = await storage.getItem(TEMPORARY_DISABLED_SITES_KEY) as Record<string, number> ?? {};
  const globalPopupEnabled = await storage.getItem(GLOBAL_AUTOFILL_POPUP_ENABLED_KEY) ?? true;

  const currentHostname = window.location.hostname;

  if (!globalPopupEnabled) {
    // Popup is disabled for all sites.
    return false;
  }

  if (disabledSites.includes(currentHostname)) {
    // Popup is permanently disabled for current site.
    return false;
  }

  // Check temporary disable
  const temporaryDisabledUntil = temporaryDisabledSites[currentHostname];
  if (temporaryDisabledUntil && Date.now() < temporaryDisabledUntil) {
    // Popup is temporarily disabled for current site.
    return false;
  }

  // Check time-based dismissal
  const dismissUntil = await storage.getItem(VAULT_LOCKED_DISMISS_UNTIL_KEY) as number;
  if (dismissUntil && Date.now() < dismissUntil) {
    // Popup is dismissed for a certain amount of time.
    return false;
  }

  return true;
}

/**
 * Disable auto-popup for current site
 */
export async function disableAutoShowPopup(temporary: boolean = false): Promise<void> {
  const currentHostname = window.location.hostname;

  if (temporary) {
    // Add to temporary disabled sites with 1 hour expiry
    const temporaryDisabledSites = await storage.getItem(TEMPORARY_DISABLED_SITES_KEY) as Record<string, number> ?? {};
    temporaryDisabledSites[currentHostname] = Date.now() + (60 * 60 * 1000); // 1 hour from now
    await storage.setItem(TEMPORARY_DISABLED_SITES_KEY, temporaryDisabledSites);
  } else {
    // Add to permanently disabled sites
    const disabledSites = await storage.getItem(DISABLED_SITES_KEY) as string[] ?? [];
    if (!disabledSites.includes(currentHostname)) {
      disabledSites.push(currentHostname);
      await storage.setItem(DISABLED_SITES_KEY, disabledSites);
    }
  }
}

/**
 * Create alias creation popup where user can choose between random alias and custom alias.
 */
export async function createAliasCreationPopup(suggestedNames: string[], rootContainer: HTMLElement): Promise<{ serviceName: string | null, isCustomCredential: boolean, customEmail?: string, customUsername?: string, customPassword?: string } | null> {
  // Close existing popup
  removeExistingPopup(rootContainer);

  // Load last used values
  const lastEmail = await storage.getItem(LAST_CUSTOM_EMAIL_KEY) as string ?? '';
  const lastUsername = await storage.getItem(LAST_CUSTOM_USERNAME_KEY) as string ?? '';

  return new Promise((resolve) => {
    (async (): Promise<void> => {
    // Create modal overlay
      const overlay = document.createElement('div');
      overlay.id = 'aliasvault-create-popup';
      overlay.className = 'av-create-popup-overlay';

      const popup = document.createElement('div');
      popup.className = 'av-create-popup';

      // Define input method base variables
      const randomIdentityIcon = `
      <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
        <circle cx="8" cy="8" r="1"/>
        <circle cx="16" cy="8" r="1"/>
        <circle cx="12" cy="12" r="1"/>
        <circle cx="8" cy="16" r="1"/>
        <circle cx="16" cy="16" r="1"/>
      </svg>
    `;
      const randomIdentitySubtext = await t('content.randomIdentityDescription');
      const randomIdentityTitle = await t('content.createRandomAlias');
      const randomIdentityTitleDropdown = await t('content.randomAlias');
      const randomIdentitySubtextDropdown = await t('content.randomIdentityDescriptionDropdown');

      const manualUsernamePasswordIcon = `
      <svg class="av-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="7" r="4"/>
        <path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>
      </svg>
    `;
      const manualUsernamePasswordSubtext = await t('content.manualCredentialDescription');
      const manualUsernamePasswordTitle = await t('content.createUsernamePassword');
      const manualUsernamePasswordTitleDropdown = await t('content.usernamePassword');
      const manualUsernamePasswordSubtextDropdown = await t('content.manualCredentialDescriptionDropdown');

      // Get all translated strings first
      const serviceNameText = await t('content.serviceName');
      const enterServiceNameText = await t('content.enterServiceName');
      const cancelText = await t('content.cancel');
      const createAndSaveAliasText = await t('content.createAndSaveAlias');
      const emailText = await t('content.email');
      const enterEmailAddressText = await t('content.enterEmailAddress');
      const usernameText = await t('content.username');
      const enterUsernameText = await t('content.enterUsername');
      const passwordText = await t('content.password');
      const generateNewPasswordText = await t('content.generateNewPassword');
      const togglePasswordVisibilityText = await t('content.togglePasswordVisibility');
      const createAndSaveCredentialText = await t('content.createAndSaveCredential');
      const passwordLengthText = await t('credentials.passwordLength');
      const changePasswordComplexityText = await t('credentials.changePasswordComplexity');

      const suggestedNamesHtml = await getSuggestedNamesHtml(suggestedNames, suggestedNames[0] ?? '');

      // Create the main content
      popup.innerHTML = `
      <div class="av-create-popup-header">
        <div class="av-create-popup-title-container">
          <div class="av-create-popup-title-wrapper">
            ${randomIdentityIcon}
            <h3 class="av-create-popup-title">${randomIdentityTitle}</h3>
          </div>
          <button class="av-create-popup-mode-dropdown">
            <svg class="av-icon" viewBox="0 0 24 24">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="av-create-popup-mode-dropdown-menu" style="display: none;">
        <button class="av-create-popup-mode-option" data-mode="random">
          <div class="av-create-popup-mode-icon">
            ${randomIdentityIcon}
          </div>
          <div class="av-create-popup-mode-content">
            <h4>${randomIdentityTitleDropdown}</h4>
            <p>${randomIdentitySubtextDropdown}</p>
          </div>
        </button>

        <button class="av-create-popup-mode-option" data-mode="custom">
          <div class="av-create-popup-mode-icon">
            ${manualUsernamePasswordIcon}
          </div>
          <div class="av-create-popup-mode-content">
            <h4>${manualUsernamePasswordTitleDropdown}</h4>
            <p>${manualUsernamePasswordSubtextDropdown}</p>
          </div>
        </button>
      </div>

      <div class="av-create-popup-help-text">${randomIdentitySubtext}</div>

      <div class="av-create-popup-field-group">
        <label for="service-name-input">${serviceNameText}</label>
        <input
          type="text"
          id="service-name-input"
          value="${suggestedNames[0] ?? ''}"
          class="av-create-popup-input"
          placeholder="${enterServiceNameText}"
        >
        ${suggestedNames.length > 1 ? `<div class="av-suggested-names">${suggestedNamesHtml}</div>` : ''}
      </div>

      <div class="av-create-popup-mode av-create-popup-random-mode">
        <div class="av-create-popup-actions">
          <button id="cancel-btn" class="av-create-popup-cancel">${cancelText}</button>
          <button id="save-btn" class="av-create-popup-save">${createAndSaveAliasText}</button>
        </div>
      </div>

      <div class="av-create-popup-mode av-create-popup-custom-mode" style="display: none;">
        <div class="av-create-popup-field-group">
          <label for="custom-email">${emailText}</label>
          <input
            type="email"
            id="custom-email"
            class="av-create-popup-input"
            placeholder="${enterEmailAddressText}"
            data-default-value="${lastEmail}"
          >
        </div>
        <div class="av-create-popup-field-group">
          <label for="custom-username">${usernameText}</label>
          <input
            type="text"
            id="custom-username"
            class="av-create-popup-input"
            placeholder="${enterUsernameText}"
            data-default-value="${lastUsername}"
          >
        </div>
        <div class="av-create-popup-field-group">
          <label>${passwordText}</label>
          <div class="av-create-popup-password-preview">
            <input
              type="text"
              id="password-preview"
              class="av-create-popup-input"
              data-is-generated="true"
            >
            <button id="toggle-password-visibility" class="av-create-popup-visibility-btn" title="${togglePasswordVisibilityText}">
              <svg class="av-icon" viewBox="0 0 24 24">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
            </button>
            <button id="regenerate-password" class="av-create-popup-regenerate-btn" title="${generateNewPasswordText}">
              <svg class="av-icon" viewBox="0 0 24 24">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
            </button>
          </div>

          <div class="av-password-length-container">
            <div class="av-password-length-header">
              <label for="password-length-slider">${passwordLengthText}</label>
              <div class="av-password-length-controls">
                <span id="password-length-value" class="av-password-length-value">12</span>
                <button id="password-config-btn" class="av-password-config-btn" title="${changePasswordComplexityText}">
                  <svg class="av-icon" viewBox="0 0 24 24">
                    <path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"></path>
                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path>
                  </svg>
                </button>
              </div>
            </div>
            <input type="range" id="password-length-slider" min="8" max="64" value="12" class="av-password-length-slider">
          </div>
        </div>
        <div class="av-create-popup-actions">
          <button id="custom-cancel-btn" class="av-create-popup-cancel">${cancelText}</button>
          <button id="custom-save-btn" class="av-create-popup-save">${createAndSaveCredentialText}</button>
        </div>
      </div>
    `;

      overlay.appendChild(popup);
      rootContainer.appendChild(overlay);

      // Animate in
      requestAnimationFrame(() => {
        popup.classList.add('show');
      });

      // Get all the elements
      const randomMode = popup.querySelector('.av-create-popup-random-mode') as HTMLElement;
      const customMode = popup.querySelector('.av-create-popup-custom-mode') as HTMLElement;
      const dropdownMenu = popup.querySelector('.av-create-popup-mode-dropdown-menu') as HTMLElement;
      const titleContainer = popup.querySelector('.av-create-popup-title-container') as HTMLElement;
      const cancelBtn = popup.querySelector('#cancel-btn') as HTMLButtonElement;
      const customCancelBtn = popup.querySelector('#custom-cancel-btn') as HTMLButtonElement;
      const saveBtn = popup.querySelector('#save-btn') as HTMLButtonElement;
      const customSaveBtn = popup.querySelector('#custom-save-btn') as HTMLButtonElement;
      const inputServiceName = popup.querySelector('#service-name-input') as HTMLInputElement;
      const customEmail = popup.querySelector('#custom-email') as HTMLInputElement;
      const customUsername = popup.querySelector('#custom-username') as HTMLInputElement;
      const passwordPreview = popup.querySelector('#password-preview') as HTMLInputElement;
      const regenerateBtn = popup.querySelector('#regenerate-password') as HTMLButtonElement;
      const toggleVisibilityBtn = popup.querySelector('#toggle-password-visibility') as HTMLButtonElement;

      /**
       * Setup default value for input with placeholder styling.
       */
      const setupDefaultValue = (input: HTMLInputElement) : void => {
        const defaultValue = input.dataset.defaultValue;
        if (defaultValue) {
          input.value = defaultValue;
          input.classList.add('av-create-popup-input-default');
        }
      };

      setupDefaultValue(customEmail);
      setupDefaultValue(customUsername);

      // Handle input changes
      customEmail.addEventListener('input', () => {
        const value = customEmail.value.trim();
        if (value || value === '') {
          customEmail.classList.remove('av-create-popup-input-default');
          storage.setItem(LAST_CUSTOM_EMAIL_KEY, value);
        } else {
          customEmail.classList.add('av-create-popup-input-default');
          storage.setItem(LAST_CUSTOM_EMAIL_KEY, '');
        }
      });

      customUsername.addEventListener('input', () => {
        const value = customUsername.value.trim();
        if (value || value === '') {
          customUsername.classList.remove('av-create-popup-input-default');
          storage.setItem(LAST_CUSTOM_USERNAME_KEY, value);
        } else {
          customUsername.classList.add('av-create-popup-input-default');
          storage.setItem(LAST_CUSTOM_USERNAME_KEY, '');
        }
      });

      // Get password settings from background
      let passwordGenerator: PasswordGenerator;
      let currentPasswordSettings: PasswordSettings = {
        Length: 12,
        UseLowercase: true,
        UseUppercase: true,
        UseNumbers: true,
        UseSpecialChars: true,
        UseNonAmbiguousChars: true
      };

      sendMessage('GET_PASSWORD_SETTINGS', {}, 'background').then((response) => {
        const passwordSettingsResponse = response as PasswordSettingsResponse;
        currentPasswordSettings = passwordSettingsResponse.settings ?? currentPasswordSettings;
        passwordGenerator = CreatePasswordGenerator(currentPasswordSettings);

        // Update UI with loaded settings
        const lengthSlider = popup.querySelector('#password-length-slider') as HTMLInputElement;
        const lengthValue = popup.querySelector('#password-length-value') as HTMLSpanElement;
        lengthSlider.value = currentPasswordSettings.Length.toString();
        lengthValue.textContent = currentPasswordSettings.Length.toString();

        // Generate initial password after settings are loaded
        generatePassword();
      });

      /**
       * Generate and set password.
       */
      const generatePassword = () : void => {
        if (!passwordGenerator) {
          return;
        }

        passwordPreview.value = passwordGenerator.generateRandomPassword();
        passwordPreview.type = 'text';
        passwordPreview.dataset.isGenerated = 'true';
        updateVisibilityIcon(true);
      };

      // Handle regenerate button click
      regenerateBtn.addEventListener('click', generatePassword);

      // Handle password length slider
      const lengthSlider = popup.querySelector('#password-length-slider') as HTMLInputElement;
      const lengthValue = popup.querySelector('#password-length-value') as HTMLSpanElement;

      lengthSlider.addEventListener('input', () => {
        const newLength = parseInt(lengthSlider.value, 10);
        currentPasswordSettings.Length = newLength;
        lengthValue.textContent = newLength.toString();

        // Regenerate password with new settings
        if (passwordGenerator) {
          passwordGenerator = CreatePasswordGenerator(currentPasswordSettings);
          generatePassword();
        }
      });

      // Handle advanced configuration button
      const configBtn = popup.querySelector('#password-config-btn') as HTMLButtonElement;
      configBtn.addEventListener('click', () => {
        showPasswordConfigDialog();
      });

      // Add password visibility toggle functionality
      const passwordInput = popup.querySelector('#password-preview') as HTMLInputElement;

      /**
       * Toggle password visibility icon
       */
      const updateVisibilityIcon = (isVisible: boolean): void => {
        toggleVisibilityBtn.innerHTML = isVisible ? `
        <svg class="av-icon" viewBox="0 0 24 24">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
          <circle cx="12" cy="12" r="3"></circle>
        </svg>
      ` : `
        <svg class="av-icon" viewBox="0 0 24 24">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
          <line x1="1" y1="1" x2="23" y2="23"></line>
        </svg>
      `;
      };

      /**
       * Toggle password visibility
       */
      const togglePasswordVisibility = (): void => {
        const isVisible = passwordInput.type === 'text';
        passwordInput.type = isVisible ? 'password' : 'text';
        updateVisibilityIcon(!isVisible);
      };

      toggleVisibilityBtn.addEventListener('click', togglePasswordVisibility);

      /**
       * Show password configuration dialog
       */
      const showPasswordConfigDialog = async (): Promise<void> => {
        // Get all translations first
        const changePasswordComplexityText = await t('credentials.changePasswordComplexity');
        const generateNewPreviewText = await t('credentials.generateNewPreview');
        const includeLowercaseText = await t('credentials.includeLowercase');
        const includeUppercaseText = await t('credentials.includeUppercase');
        const includeNumbersText = await t('credentials.includeNumbers');
        const includeSpecialCharsText = await t('credentials.includeSpecialChars');
        const avoidAmbiguousCharsText = await t('credentials.avoidAmbiguousChars');
        const useText = await t('common.use');

        // Create dialog overlay
        const dialogOverlay = document.createElement('div');
        dialogOverlay.className = 'av-password-config-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'av-password-config-dialog';

        dialog.innerHTML = `
          <div class="av-password-config-header">
            <h3>${changePasswordComplexityText}</h3>
            <button class="av-password-config-close">
              <svg class="av-icon" viewBox="0 0 24 24">
                <path d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
          </div>

          <div class="av-password-config-content">
            <div class="av-password-preview-section">
              <input type="text" id="config-preview" class="av-password-config-preview" readonly>
              <button id="config-refresh" class="av-password-config-refresh" title="${generateNewPreviewText}">
                <svg class="av-icon" viewBox="0 0 24 24">
                  <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
                </svg>
              </button>
            </div>

            <div class="av-password-config-options">
              <div class="av-password-config-toggles">
                <button class="av-password-config-toggle ${currentPasswordSettings.UseLowercase ? 'active' : ''}" data-setting="UseLowercase" title="${includeLowercaseText}">
                  <span>a-z</span>
                </button>
                <button class="av-password-config-toggle ${currentPasswordSettings.UseUppercase ? 'active' : ''}" data-setting="UseUppercase" title="${includeUppercaseText}">
                  <span>A-Z</span>
                </button>
                <button class="av-password-config-toggle ${currentPasswordSettings.UseNumbers ? 'active' : ''}" data-setting="UseNumbers" title="${includeNumbersText}">
                  <span>0-9</span>
                </button>
                <button class="av-password-config-toggle ${currentPasswordSettings.UseSpecialChars ? 'active' : ''}" data-setting="UseSpecialChars" title="${includeSpecialCharsText}">
                  <span>!@#</span>
                </button>
              </div>

              <div class="av-password-config-checkbox">
                <label>
                  <input type="checkbox" id="avoid-ambiguous" ${currentPasswordSettings.UseNonAmbiguousChars ? 'checked' : ''}>
                  <span>${avoidAmbiguousCharsText}</span>
                </label>
              </div>
            </div>

            <div class="av-password-config-actions">
              <button id="config-use-btn" class="av-password-config-use">
                <svg class="av-icon" viewBox="0 0 24 24">
                  <path d="M15 13l-3 3m0 0l-3-3m3 3V8m0 13a9 9 0 110-18 9 9 0 010 18z"/>
                </svg>
                ${useText}
              </button>
            </div>
          </div>
        `;

        dialogOverlay.appendChild(dialog);
        popup.appendChild(dialogOverlay);

        // Generate initial preview
        const configPreview = dialog.querySelector('#config-preview') as HTMLInputElement;
        /**
         * Update the config preview.
         */
        const updateConfigPreview = (): void => {
          if (passwordGenerator) {
            passwordGenerator = CreatePasswordGenerator(currentPasswordSettings);
            configPreview.value = passwordGenerator.generateRandomPassword();
          }
        };
        updateConfigPreview();

        // Handle toggle buttons
        dialog.querySelectorAll('.av-password-config-toggle').forEach(toggle => {
          toggle.addEventListener('click', () => {
            const setting = (toggle as HTMLElement).dataset.setting;
            if (setting) {
              switch (setting) {
                case 'UseLowercase':
                  currentPasswordSettings.UseLowercase = !currentPasswordSettings.UseLowercase;
                  toggle.classList.toggle('active', currentPasswordSettings.UseLowercase);
                  break;
                case 'UseUppercase':
                  currentPasswordSettings.UseUppercase = !currentPasswordSettings.UseUppercase;
                  toggle.classList.toggle('active', currentPasswordSettings.UseUppercase);
                  break;
                case 'UseNumbers':
                  currentPasswordSettings.UseNumbers = !currentPasswordSettings.UseNumbers;
                  toggle.classList.toggle('active', currentPasswordSettings.UseNumbers);
                  break;
                case 'UseSpecialChars':
                  currentPasswordSettings.UseSpecialChars = !currentPasswordSettings.UseSpecialChars;
                  toggle.classList.toggle('active', currentPasswordSettings.UseSpecialChars);
                  break;
              }
              updateConfigPreview();
            }
          });
        });

        // Handle checkbox
        const avoidAmbiguousCheckbox = dialog.querySelector('#avoid-ambiguous') as HTMLInputElement;
        avoidAmbiguousCheckbox.addEventListener('change', () => {
          currentPasswordSettings.UseNonAmbiguousChars = avoidAmbiguousCheckbox.checked;
          updateConfigPreview();
        });

        // Handle refresh button
        const refreshBtn = dialog.querySelector('#config-refresh') as HTMLButtonElement;
        refreshBtn.addEventListener('click', updateConfigPreview);

        // Handle use button
        const useBtn = dialog.querySelector('#config-use-btn') as HTMLButtonElement;
        useBtn.addEventListener('click', () => {
          passwordPreview.value = configPreview.value;
          passwordPreview.type = 'text';
          passwordPreview.dataset.isGenerated = 'true';
          updateVisibilityIcon(true);

          // Update main password generator
          passwordGenerator = CreatePasswordGenerator(currentPasswordSettings);

          // Update slider value
          lengthSlider.value = currentPasswordSettings.Length.toString();
          lengthValue.textContent = currentPasswordSettings.Length.toString();

          // Close dialog
          dialogOverlay.remove();
        });

        // Handle close button
        const closeBtn = dialog.querySelector('.av-password-config-close') as HTMLButtonElement;
        closeBtn.addEventListener('click', () => {
          dialogOverlay.remove();
        });

        // Handle click outside to close
        dialogOverlay.addEventListener('click', (e) => {
          if (e.target === dialogOverlay) {
            dialogOverlay.remove();
          }
        });
      };

      /**
       * Handle password input changes
       */
      const handlePasswordChange = (e: Event): void => {
        const target = e.target as HTMLInputElement;
        const isGenerated = target.dataset.isGenerated === 'true';
        const isEmpty = target.value.trim().length <= 1;

        // If manually cleared (empty or single char) and was previously generated, switch to password type
        if (isEmpty && isGenerated) {
          target.type = 'password';
          target.dataset.isGenerated = 'false';
          updateVisibilityIcon(false);
        }
      };

      /**
       * Handle paste events
       */
      const handlePasswordPaste = (): void => {
        passwordInput.dataset.isGenerated = 'false';
        passwordInput.type = 'password';
        updateVisibilityIcon(false);
      };

      passwordInput.addEventListener('input', handlePasswordChange);
      passwordInput.addEventListener('paste', handlePasswordPaste);

      /**
       * Toggle dropdown visibility.
       */
      const toggleDropdown = () : void => {
        dropdownMenu.style.display = dropdownMenu.style.display === 'none' ? 'block' : 'none';
      };

      // Make title container clickable to trigger the dropdown
      titleContainer.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleDropdown();
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', (e) => {
        if (!titleContainer.contains(e.target as Node) && !dropdownMenu.contains(e.target as Node)) {
          dropdownMenu.style.display = 'none';
        }
      });

      // Handle mode option clicks
      dropdownMenu.querySelectorAll('.av-create-popup-mode-option').forEach(option => {
        option.addEventListener('click', () => {
          const mode = (option as HTMLElement).dataset.mode;
          const titleWrapper = popup.querySelector('.av-create-popup-title-wrapper') as HTMLElement;
          if (mode === 'random') {
            titleWrapper.innerHTML = `
            ${randomIdentityIcon}
            <h3 class="av-create-popup-title">${randomIdentityTitle}</h3>
          `;
          popup.querySelector('.av-create-popup-help-text')!.textContent = randomIdentitySubtext;
          randomMode.style.display = 'block';
          customMode.style.display = 'none';
          } else if (mode === 'custom') {
            titleWrapper.innerHTML = `
            ${manualUsernamePasswordIcon}
            <h3 class="av-create-popup-title">${manualUsernamePasswordTitle}</h3>
          `;
          popup.querySelector('.av-create-popup-help-text')!.textContent = manualUsernamePasswordSubtext;
          randomMode.style.display = 'none';
          customMode.style.display = 'block';
          }
          dropdownMenu.style.display = 'none';
        });
      });

      /**
       * Close the popup.
       */
      const closePopup = (value: { serviceName: string | null, isCustomCredential: boolean, customEmail?: string, customUsername?: string, customPassword?: string } | null) : void => {
        popup.classList.remove('show');
        setTimeout(() => {
          overlay.remove();
          resolve(value);
        }, 200);
      };

      // Handle save buttons
      saveBtn.addEventListener('click', () => {
        const serviceName = inputServiceName.value.trim();
        if (serviceName) {
          closePopup({
            serviceName,
            isCustomCredential: false
          });
        }
      });

      /**
       * Handle custom save button click.
       */
      const handleCustomSave = async () : Promise<void> => {
        const serviceName = inputServiceName.value.trim();
        if (serviceName) {
          const email = customEmail.value.trim();
          const username = customUsername.value.trim();
          const hasDefaultEmail = customEmail.classList.contains('av-create-popup-input-default');
          const hasDefaultUsername = customUsername.classList.contains('av-create-popup-input-default');

          // If using default values, use the dataset values
          const finalEmail = hasDefaultEmail ? customEmail.dataset.defaultValue : email;
          const finalUsername = hasDefaultUsername ? customUsername.dataset.defaultValue : username;

          if (!finalEmail && !finalUsername) {
          // Add error styling to fields
            customEmail.classList.add('av-create-popup-input-error');
            customUsername.classList.add('av-create-popup-input-error');

            // Add error messages after labels
            const emailLabel = customEmail.previousElementSibling as HTMLLabelElement;
            const usernameLabel = customUsername.previousElementSibling as HTMLLabelElement;

            if (!emailLabel.querySelector('.av-create-popup-error-text')) {
              const emailError = document.createElement('span');
              emailError.className = 'av-create-popup-error-text';
              emailError.textContent = await t('content.enterEmailAndOrUsername');
              emailLabel.appendChild(emailError);
            }

            if (!usernameLabel.querySelector('.av-create-popup-error-text')) {
              const usernameError = document.createElement('span');
              usernameError.className = 'av-create-popup-error-text';
              usernameError.textContent = await t('content.enterEmailAndOrUsername');
              usernameLabel.appendChild(usernameError);
            }

            /**
             * Remove error styling.
             */
            const removeError = () : void => {
              customEmail.classList.remove('av-create-popup-input-error');
              customUsername.classList.remove('av-create-popup-input-error');
              const emailError = emailLabel.querySelector('.av-create-popup-error-text');
              const usernameError = usernameLabel.querySelector('.av-create-popup-error-text');
              if (emailError) {
                emailError.remove();
              }
              if (usernameError) {
                usernameError.remove();
              }
            };

            customEmail.addEventListener('input', removeError, { once: true });
            customUsername.addEventListener('input', removeError, { once: true });

            return;
          }

          closePopup({
            serviceName,
            isCustomCredential: true,
            customEmail: finalEmail,
            customUsername: finalUsername,
            customPassword: passwordPreview.value
          });
        }
      }

      customSaveBtn.addEventListener('click', handleCustomSave);

      /**
       * Handle custom form input enter key press to submit the form.
       */
      const handleCustomEnter = (e: KeyboardEvent) : void => {
        if (e.key === 'Enter') {
          handleCustomSave();
        }
      };

      inputServiceName.addEventListener('keyup', handleCustomEnter);
      customEmail.addEventListener('keyup', handleCustomEnter);
      customUsername.addEventListener('keyup', handleCustomEnter);
      passwordPreview.addEventListener('keyup', handleCustomEnter);

      // Handle cancel buttons
      cancelBtn.addEventListener('click', () => {
        closePopup(null);
      });

      customCancelBtn.addEventListener('click', () => {
        closePopup(null);
      });

      // Handle Enter key
      inputServiceName.addEventListener('keyup', (e) => {
        if (e.key === 'Enter') {
          const serviceName = inputServiceName.value.trim();
          if (serviceName) {
            closePopup({
              serviceName,
              isCustomCredential: false
            });
          }
        }
      });

      /**
       * Handle click outside.
       */
      const handleClickOutside = (event: MouseEvent): void => {
        const target = event.target as Node;
        if (target === overlay) {
          closePopup(null);
        }
      };

      // Use mousedown instead of click to prevent closing when dragging text
      overlay.addEventListener('mousedown', handleClickOutside);

      /**
       * Handle suggested name click.
       */
      const handleSuggestedNameClick = async (e: Event) : Promise<void> => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('av-suggested-name')) {
          const name = target.dataset.name;
          if (name) {
          // Update input with clicked name
            inputServiceName.value = name;
            customUsername.value = name;

            // Update the suggested names section
            const suggestedNamesContainer = target.closest('.av-suggested-names');
            if (suggestedNamesContainer) {
            // Update the suggestions HTML using the helper function
              suggestedNamesContainer.innerHTML = await getSuggestedNamesHtml(suggestedNames, name);
            }
          }
        }
      };

      popup.addEventListener('click', handleSuggestedNameClick);

      // Focus the input field
      inputServiceName.select();
    })();
  });
}

/**
 * Get suggested names HTML with current input value excluded
 */
async function getSuggestedNamesHtml(suggestedNames: string[], currentValue: string): Promise<string> {
  // Filter out the current value and create unique set of remaining suggestions
  const filteredSuggestions = [...new Set(suggestedNames.filter(n => n !== currentValue))];

  if (filteredSuggestions.length === 0) {
    return '';
  }

  const orLabel = await t('content.or');

  return `${orLabel} ${filteredSuggestions.map((name, index) =>
    `<span class="av-suggested-name" data-name="${name}">${name}</span>${index < filteredSuggestions.length - 1 ? ', ' : ''}`
  ).join('')}?`;
}

/**
 * Get favicon bytes from page and resize if necessary.
 */
async function getFaviconBytes(document: Document): Promise<Uint8Array | null> {
  const MAX_SIZE_BYTES = 50 * 1024; // 50KB max size before resizing
  const TARGET_WIDTH = 96; // Resize target width

  const faviconLinks = [
    ...Array.from(document.querySelectorAll('link[rel="icon"][type="image/svg+xml"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"][sizes="96x96"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"][sizes="128x128"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"][sizes="48x48"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"][sizes="32x32"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"][sizes="192x192"]')),
    ...Array.from(document.querySelectorAll('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]')),
    ...Array.from(document.querySelectorAll('link[rel="icon"], link[rel="shortcut icon"]')),
    { href: `${window.location.origin}/favicon.ico` }
  ] as HTMLLinkElement[];

  const uniqueLinks = Array.from(new Map(faviconLinks.map(link => [link.href, link])).values());

  for (const link of uniqueLinks) {
    const imageData = await fetchAndProcessFavicon(link.href, MAX_SIZE_BYTES, TARGET_WIDTH);
    if (imageData) {
      return imageData;
    }
  }

  return null;
}

/**
 * Attempt to fetch and process a favicon from a given URL
 */
async function fetchAndProcessFavicon(url: string, maxSize: number, targetWidth: number): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get('content-type');
    if (!contentType?.startsWith('image/')) {
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      return null;
    }

    let imageData = new Uint8Array(arrayBuffer);

    // If image is too large, attempt to resize
    if (imageData.byteLength > maxSize) {
      const resizedBlob = await resizeImage(imageData, contentType, targetWidth);
      if (resizedBlob) {
        imageData = new Uint8Array(await resizedBlob.arrayBuffer());
      }
    }

    // Return only if within size limits
    return imageData.byteLength <= maxSize ? imageData : null;
  } catch (error) {
    console.error('Error fetching favicon:', url, error);
    return null;
  }
}

/**
 * Resizes an image using OffscreenCanvas and compresses it.
 */
async function resizeImage(imageData: Uint8Array, contentType: string, targetWidth: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    // Convert Uint8Array to ArrayBuffer to ensure compatibility with Blob
    const arrayBuffer = imageData.buffer.slice(
      imageData.byteOffset,
      imageData.byteOffset + imageData.byteLength
    ) as ArrayBuffer; // Assert as ArrayBuffer to ensure type compatibility
    const blob = new Blob([arrayBuffer], { type: contentType });
    const img = new Image();

    /**
     * Handle image load.
     */
    img.onload = () : void => {
      const scale = targetWidth / img.width;
      const targetHeight = Math.floor(img.height * scale);

      const canvas = new OffscreenCanvas(targetWidth, targetHeight);
      const ctx = canvas.getContext("2d");

      if (!ctx) {
        resolve(null);
        return;
      }

      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
      canvas.convertToBlob({ type: "image/png", quality: 0.7 }).then(resolve).catch(() => resolve(null));
    };

    /**
     * Handle image load error.
     */
    img.onerror = () : void => {
      resolve(null);
    };

    img.src = URL.createObjectURL(blob);
  });
}

/**
 * Dismiss vault locked popup for 4 hours if user is logged in, or for 3 days if user is not logged in.
 */
export async function dismissVaultLockedPopup(): Promise<void> {
  // First check if user is logged in or not.
  const authStatus = await sendMessage('CHECK_AUTH_STATUS', {}, 'background') as { isLoggedIn: boolean, isVaultLocked: boolean };

  if (authStatus.isLoggedIn) {
    // User is logged in - dismiss for 4 hours
    const fourHoursFromNow = Date.now() + (4 * 60 * 60 * 1000);
    await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, fourHoursFromNow);
  } else {
    // User is not logged in - dismiss for 3 days
    const threeDaysFromNow = Date.now() + (3 * 24 * 60 * 60 * 1000);
    await storage.setItem(VAULT_LOCKED_DISMISS_UNTIL_KEY, threeDaysFromNow);
  }
}

/**
 * Get a valid service URL from the current page.
 */
function getValidServiceUrl(): string {
  try {
    // Check if we're in an iframe with invalid/null source
    if (window !== window.top && (!window.location.href || window.location.href === 'about:srcdoc')) {
      return '';
    }

    const url = new URL(window.location.href);

    // Validate the domain/origin
    if (!url.origin || url.origin === 'null' || !url.hostname) {
      return '';
    }

    // Check for valid protocol (only http/https)
    if (!(/^https?:$/).exec(url.protocol)) {
      return '';
    }

    return url.origin + url.pathname;
  } catch (error) {
    console.debug('Error validating service URL:', error);
    return '';
  }
}

/**
 * Add click handler with mousedown/mouseup backup for better click reliability in shadow DOM.
 *
 * Some websites due to their design cause the AliasVault autofill to re-trigger when clicking
 * outside of the input field, which causes the AliasVault popup to close before the click event
 * is registered. This is a workaround to ensure the click event is always registered.
 */
function addReliableClickHandler(element: HTMLElement, handler: (e: Event) => void): void {
  // Add primary click listener with capture and prevent removal
  element.addEventListener('click', handler, {
    capture: true,
    passive: false
  });

  // Backup click handling using mousedown/mouseup if needed
  let isMouseDown = false;
  element.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    isMouseDown = true;
  }, { capture: true });

  element.addEventListener('mouseup', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isMouseDown) {
      handler(e);
    }
    isMouseDown = false;
  }, { capture: true });
}

/**
 * Create upgrade required popup.
 */
export async function createUpgradeRequiredPopup(input: HTMLInputElement, rootContainer: HTMLElement, errorMessage: string): Promise<void> {
  /**
   * Handle upgrade click.
   */
  const handleUpgradeClick = () : void => {
    sendMessage('OPEN_POPUP', {}, 'background');
    removeExistingPopup(rootContainer);
  }

  const popup = createBasePopup(input, rootContainer);
  popup.classList.add('av-upgrade-required');

  // Create container for message and button
  const container = document.createElement('div');
  container.className = 'av-upgrade-required-container';

  // Make the entire container clickable
  addReliableClickHandler(container, handleUpgradeClick);
  container.style.cursor = 'pointer';

  // Add message
  const messageElement = document.createElement('div');
  messageElement.className = 'av-upgrade-required-message';
  messageElement.textContent = errorMessage;
  container.appendChild(messageElement);

  // Add upgrade button with SVG icon
  const button = document.createElement('button');
  button.title = await t('content.openAliasVaultToUpgrade');
  button.className = 'av-upgrade-required-button';
  button.innerHTML = `
    <svg class="av-icon-upgrade" viewBox="0 0 24 24">
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"></path>
    </svg>
  `;
  container.appendChild(button);

  // Add the container to the popup
  popup.appendChild(container);

  // Add close button as a separate element positioned to the right
  const closeButton = document.createElement('button');
  closeButton.className = 'av-button av-button-close av-upgrade-required-close';
  closeButton.title = await t('content.dismissPopup');
  closeButton.innerHTML = `
    <svg class="av-icon" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  // Position the close button to the right of the container
  closeButton.style.position = 'absolute';
  closeButton.style.right = '8px';
  closeButton.style.top = '50%';
  closeButton.style.transform = 'translateY(-50%)';

  // Handle close button click
  addReliableClickHandler(closeButton, (e) => {
    e.stopPropagation(); // Prevent opening the upgrade popup
    removeExistingPopup(rootContainer);
  });

  popup.appendChild(closeButton);

  /**
   * Add event listener to document to close popup when clicking outside.
   */
  const handleClickOutside = (event: MouseEvent): void => {
    const target = event.target as Node;
    const targetElement = event.target as HTMLElement;

    // Check if the click is outside the popup and outside the shadow UI
    if (popup && !popup.contains(target) && !input.contains(target) && targetElement.tagName !== 'ALIASVAULT-UI') {
      removeExistingPopup(rootContainer);
      document.removeEventListener('mousedown', handleClickOutside);
    }
  };

  setTimeout(() => {
    document.addEventListener('mousedown', handleClickOutside);
  }, 100);

  rootContainer.appendChild(popup);
}
