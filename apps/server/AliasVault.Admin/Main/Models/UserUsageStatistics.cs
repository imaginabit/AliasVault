//-----------------------------------------------------------------------
// <copyright file="UserUsageStatistics.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.Admin.Main.Models;

/// <summary>
/// Model representing user-specific usage statistics for both all-time and recent periods.
/// </summary>
public class UserUsageStatistics
{
    /// <summary>
    /// Gets or sets the total number of credentials (all-time).
    /// </summary>
    public int TotalCredentials { get; set; }

    /// <summary>
    /// Gets or sets the total number of email claims (all-time).
    /// </summary>
    public int TotalEmailClaims { get; set; }

    /// <summary>
    /// Gets or sets the total number of received emails (all-time).
    /// </summary>
    public int TotalReceivedEmails { get; set; }

    /// <summary>
    /// Gets or sets the number of credentials created in the last 72 hours.
    /// </summary>
    public int RecentCredentials72h { get; set; }

    /// <summary>
    /// Gets or sets the number of email claims created in the last 72 hours.
    /// </summary>
    public int RecentEmailClaims72h { get; set; }

    /// <summary>
    /// Gets or sets the number of emails received in the last 72 hours.
    /// </summary>
    public int RecentReceivedEmails72h { get; set; }

    /// <summary>
    /// Gets or sets the total number of email attachments (all-time).
    /// </summary>
    public int TotalEmailAttachments { get; set; }

    /// <summary>
    /// Gets or sets the total storage size of email attachments in bytes (all-time).
    /// </summary>
    public long TotalEmailAttachmentStorage { get; set; }

    /// <summary>
    /// Gets the total storage size of email attachments in MB for display purposes.
    /// </summary>
    public double TotalEmailAttachmentStorageMB => TotalEmailAttachmentStorage / (1024.0 * 1024.0);
}
