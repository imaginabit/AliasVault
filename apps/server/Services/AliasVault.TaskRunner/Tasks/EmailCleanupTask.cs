//-----------------------------------------------------------------------
// <copyright file="EmailCleanupTask.cs" company="lanedirt">
// Copyright (c) lanedirt. All rights reserved.
// Licensed under the AGPLv3 license. See LICENSE.md file in the project root for full license information.
// </copyright>
//-----------------------------------------------------------------------

namespace AliasVault.TaskRunner.Tasks;

using AliasServerDb;
using AliasVault.Shared.Server.Services;
using Microsoft.EntityFrameworkCore;

/// <summary>
/// A maintenance task that deletes old emails based on server settings.
/// </summary>
public class EmailCleanupTask : IMaintenanceTask
{
    private readonly ILogger<EmailCleanupTask> _logger;
    private readonly IAliasServerDbContextFactory _dbContextFactory;
    private readonly ServerSettingsService _settingsService;

    /// <summary>
    /// Initializes a new instance of the <see cref="EmailCleanupTask"/> class.
    /// </summary>
    /// <param name="logger">The logger.</param>
    /// <param name="dbContextFactory">The database context factory.</param>
    /// <param name="settingsService">The settings service.</param>
    public EmailCleanupTask(
        ILogger<EmailCleanupTask> logger,
        IAliasServerDbContextFactory dbContextFactory,
        ServerSettingsService settingsService)
    {
        _logger = logger;
        _dbContextFactory = dbContextFactory;
        _settingsService = settingsService;
    }

    /// <inheritdoc />
    public string Name => "Email Cleanup";

    /// <inheritdoc />
    public async Task ExecuteAsync(CancellationToken cancellationToken)
    {
        var settings = await _settingsService.GetAllSettingsAsync();
        await using var dbContext = await _dbContextFactory.CreateDbContextAsync(cancellationToken);

        var totalEmailsDeleted = 0;

        // First handle global retention settings
        if (settings.EmailRetentionDays > 0)
        {
            var globalCutoffDate = DateTime.UtcNow.AddDays(-settings.EmailRetentionDays);

            // Delete the emails based on global settings
            var globalEmailsDeleted = await dbContext.Emails
                .Where(x => x.DateSystem < globalCutoffDate)
                .ExecuteDeleteAsync(cancellationToken);

            if (globalEmailsDeleted > 0)
            {
                totalEmailsDeleted += globalEmailsDeleted;
                _logger.LogWarning(
                    "Deleted {EmailCount} emails older than {Days} days (global setting)",
                    globalEmailsDeleted,
                    settings.EmailRetentionDays);
            }
        }

        // Now handle per-user age limits
        var usersWithAgeLimits = await dbContext.AliasVaultUsers
            .Where(u => u.MaxEmailAgeDays > 0)
            .Select(u => new { u.Id, u.UserName, u.MaxEmailAgeDays })
            .ToListAsync(cancellationToken);

        foreach (var user in usersWithAgeLimits)
        {
            var userCutoffDate = DateTime.UtcNow.AddDays(-user.MaxEmailAgeDays);

            // Get all email addresses for this user
            var userAddresses = await dbContext.UserEmailClaims
                .Where(c => c.UserId == user.Id)
                .Select(c => c.Address)
                .ToListAsync(cancellationToken);

            if (userAddresses.Count > 0)
            {
                // Delete emails older than user's limit
                var userEmailsDeleted = await dbContext.Emails
                    .Where(e => userAddresses.Contains(e.To) && e.DateSystem < userCutoffDate)
                    .ExecuteDeleteAsync(cancellationToken);

                if (userEmailsDeleted > 0)
                {
                    totalEmailsDeleted += userEmailsDeleted;
                    _logger.LogWarning(
                        "Deleted {EmailCount} emails older than {Days} days for user {UserName} (user-specific setting)",
                        userEmailsDeleted,
                        user.MaxEmailAgeDays,
                        user.UserName);
                }
            }
        }

        if (totalEmailsDeleted > 0)
        {
            _logger.LogWarning(
                "Total emails deleted by age cleanup: {TotalEmails}",
                totalEmailsDeleted);
        }
    }
}
