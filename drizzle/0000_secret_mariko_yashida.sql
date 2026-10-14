CREATE TABLE `AuthSession` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`userIdentityId` varchar(36) NOT NULL,
	`tokenHash` varchar(64) NOT NULL,
	`sessionKind` enum('authenticated','password_enrollment') NOT NULL DEFAULT 'authenticated',
	`expiresAt` datetime(3) NOT NULL,
	`revokedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL,
	CONSTRAINT `AuthSession_id` PRIMARY KEY(`id`),
	CONSTRAINT `AuthSession_token_uq` UNIQUE(`tokenHash`)
);
--> statement-breakpoint
CREATE TABLE `EnterpriseProfileSyncState` (
	`id` varchar(36) NOT NULL,
	`userIdentityId` varchar(36) NOT NULL,
	`profileFingerprint` varchar(72) NOT NULL,
	`lastVerifiedAt` datetime(3) NOT NULL,
	`freshUntil` datetime(3) NOT NULL,
	`staleUntil` datetime(3) NOT NULL,
	`lastSyncErrorCode` varchar(96),
	`sourceSystem` varchar(128) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `EnterpriseProfileSyncState_id` PRIMARY KEY(`id`),
	CONSTRAINT `EnterpriseProfileSyncState_user_uq` UNIQUE(`userIdentityId`)
);
--> statement-breakpoint
CREATE TABLE `LocalCredential` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`userIdentityId` varchar(36) NOT NULL,
	`normalizedAccount` varchar(128) NOT NULL,
	`passwordHash` varchar(512) NOT NULL,
	`failedLoginCount` int NOT NULL DEFAULT 0,
	`lockedUntil` datetime(3),
	`passwordChangedAt` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `LocalCredential_id` PRIMARY KEY(`id`),
	CONSTRAINT `LocalCredential_tenant_account_uq` UNIQUE(`tenantId`,`normalizedAccount`),
	CONSTRAINT `LocalCredential_user_uq` UNIQUE(`userIdentityId`)
);
--> statement-breakpoint
CREATE TABLE `PrincipalBinding` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`subjectType` enum('user','group','role','department') NOT NULL,
	`externalId` varchar(128) NOT NULL,
	`displayName` text,
	`userIdentityId` varchar(36),
	`createdAt` datetime NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `PrincipalBinding_id` PRIMARY KEY(`id`),
	CONSTRAINT `PrincipalBinding_tenant_type_external_uq` UNIQUE(`tenantId`,`subjectType`,`externalId`)
);
--> statement-breakpoint
CREATE TABLE `Tenant` (
	`id` varchar(36) NOT NULL,
	`key` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`status` enum('active','suspended') NOT NULL DEFAULT 'active',
	`createdAt` datetime NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `Tenant_id` PRIMARY KEY(`id`),
	CONSTRAINT `Tenant_key_uq` UNIQUE(`key`)
);
--> statement-breakpoint
CREATE TABLE `UserExtensionAttribute` (
	`id` varchar(36) NOT NULL,
	`userIdentityId` varchar(36) NOT NULL,
	`attributeKey` varchar(96) NOT NULL,
	`valueType` enum('string','number','boolean','json') NOT NULL,
	`stringValue` text,
	`numberValue` decimal(30,10),
	`booleanValue` boolean,
	`jsonValue` json,
	`sourceSystem` varchar(128) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `UserExtensionAttribute_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserExtensionAttribute_user_key_uq` UNIQUE(`userIdentityId`,`attributeKey`),
	CONSTRAINT `UserExtensionAttribute_value_slot_ck` CHECK((
        (valueType = 'string' AND stringValue IS NOT NULL AND numberValue IS NULL AND booleanValue IS NULL AND jsonValue IS NULL)
        OR (valueType = 'number' AND stringValue IS NULL AND numberValue IS NOT NULL AND booleanValue IS NULL AND jsonValue IS NULL)
        OR (valueType = 'boolean' AND stringValue IS NULL AND numberValue IS NULL AND booleanValue IS NOT NULL AND jsonValue IS NULL)
        OR (valueType = 'json' AND stringValue IS NULL AND numberValue IS NULL AND booleanValue IS NULL AND jsonValue IS NOT NULL)
      ))
);
--> statement-breakpoint
CREATE TABLE `UserIdentity` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`externalSubject` varchar(128) NOT NULL,
	`loginAccount` varchar(128),
	`email` varchar(128) NOT NULL,
	`displayName` text,
	`status` enum('active','disabled') NOT NULL DEFAULT 'active',
	`createdAt` datetime NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `UserIdentity_id` PRIMARY KEY(`id`),
	CONSTRAINT `UserIdentity_tenant_subject_uq` UNIQUE(`tenantId`,`externalSubject`),
	CONSTRAINT `UserIdentity_tenant_account_uq` UNIQUE(`tenantId`,`loginAccount`)
);
--> statement-breakpoint
CREATE TABLE `PermissionGroup` (
	`principalId` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`source` varchar(160) NOT NULL DEFAULT 'local',
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `PermissionGroup_principalId` PRIMARY KEY(`principalId`)
);
--> statement-breakpoint
CREATE TABLE `PermissionGroupMember` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`groupId` varchar(36) NOT NULL,
	`userId` varchar(36) NOT NULL,
	`validUntil` datetime(3),
	CONSTRAINT `PermissionGroupMember_id` PRIMARY KEY(`id`),
	CONSTRAINT `PermissionGroupMember_uq` UNIQUE(`tenantId`,`groupId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `PermissionRole` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`name` varchar(128) NOT NULL,
	`permissions` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `PermissionRole_id` PRIMARY KEY(`id`),
	CONSTRAINT `PermissionRole_tenant_name_uq` UNIQUE(`tenantId`,`name`)
);
--> statement-breakpoint
CREATE TABLE `PermissionRoleAssignment` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`principalId` varchar(36) NOT NULL,
	`roleKey` varchar(96) NOT NULL,
	`source` varchar(128) NOT NULL DEFAULT 'local',
	CONSTRAINT `PermissionRoleAssignment_id` PRIMARY KEY(`id`),
	CONSTRAINT `PermissionRoleAssignment_uq` UNIQUE(`tenantId`,`principalId`,`roleKey`,`source`)
);
--> statement-breakpoint
CREATE TABLE `ResourceAccessPolicy` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`resourceType` varchar(64) NOT NULL,
	`resourceId` varchar(36) NOT NULL,
	`mode` varchar(16) NOT NULL DEFAULT 'inherit',
	`principals` json NOT NULL,
	`collaborators` json NOT NULL,
	`version` int NOT NULL DEFAULT 1,
	CONSTRAINT `ResourceAccessPolicy_id` PRIMARY KEY(`id`),
	CONSTRAINT `ResourceAccessPolicy_resource_uq` UNIQUE(`tenantId`,`resourceType`,`resourceId`)
);
--> statement-breakpoint
CREATE TABLE `RoleActionBinding` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`principalBindingId` varchar(36) NOT NULL,
	`actionCode` varchar(64) NOT NULL,
	`resourceScopeJson` text NOT NULL,
	`validFrom` datetime(3) NOT NULL,
	`validUntil` datetime(3),
	`createdAt` datetime NOT NULL,
	CONSTRAINT `RoleActionBinding_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `DeletionRequest` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`subjectType` enum('thread','memory_entry','artifact','user','retention_scope','user_data_export_scope') NOT NULL,
	`subjectId` varchar(128) NOT NULL,
	`deleteMode` enum('standard','privacy_request','retention_expiry') NOT NULL,
	`reasonCode` varchar(64) NOT NULL,
	`policyRevisionId` varchar(64),
	`requestedBy` varchar(128) NOT NULL,
	`requestPrincipalKind` enum('user','service') NOT NULL DEFAULT 'user',
	`requestState` enum('planning','blocked_by_hold','deleting','completed','partial','failed','cancelled') NOT NULL DEFAULT 'planning',
	`blockedReasonCodes` text,
	`auditEventId` varchar(36),
	`acceptedAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	CONSTRAINT `DeletionRequest_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `DeletionStep` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`requestId` varchar(36) NOT NULL,
	`storeType` enum('mysql','object_storage','vector_search','trace_log','cache') NOT NULL,
	`subjectRef` varchar(256) NOT NULL,
	`stepState` enum('pending','running','completed','failed','blocked','retained','skipped') NOT NULL DEFAULT 'pending',
	`evidenceRef` varchar(256),
	`failureReason` text,
	`attemptCount` int NOT NULL DEFAULT 0,
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	`completedAt` datetime(3),
	CONSTRAINT `DeletionStep_id` PRIMARY KEY(`id`),
	CONSTRAINT `DeletionStep_request_store_subject_uq` UNIQUE(`requestId`,`storeType`,`subjectRef`)
);
--> statement-breakpoint
CREATE TABLE `LegalHold` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`targetType` enum('tenant','thread','invocation','job','artifact','agent_revision') NOT NULL,
	`targetId` varchar(128) NOT NULL,
	`holdState` enum('active','released') NOT NULL DEFAULT 'active',
	`reason` text NOT NULL,
	`createdBy` varchar(128) NOT NULL,
	`approvedBy` varchar(128) NOT NULL,
	`validUntil` datetime(3) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`releasedAt` datetime(3),
	`releasedBy` varchar(128),
	`releaseReason` text,
	CONSTRAINT `LegalHold_id` PRIMARY KEY(`id`),
	CONSTRAINT `LegalHold_tenant_target_uq` UNIQUE(`tenantId`,`targetType`,`targetId`)
);
--> statement-breakpoint
CREATE TABLE `RetentionPolicy` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`objectType` enum('thread','event','trace','audit','artifact','memory','knowledge','job','security_log') NOT NULL,
	`retentionDays` varchar(16) NOT NULL,
	`legalHoldDays` varchar(16),
	`dataClass` varchar(64) NOT NULL,
	`statutoryRequirements` text NOT NULL,
	`description` text NOT NULL,
	`createdBy` varchar(128) NOT NULL,
	`createdAt` datetime(3) NOT NULL,
	`updatedBy` varchar(128) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `RetentionPolicy_id` PRIMARY KEY(`id`),
	CONSTRAINT `RetentionPolicy_tenant_object_uq` UNIQUE(`tenantId`,`objectType`)
);
--> statement-breakpoint
CREATE TABLE `IncidentContainment` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`incidentId` varchar(36) NOT NULL,
	`actionType` enum('revoke_credential','disable_tool_provider','disable_tool','disable_route','withdraw_agent_revision','withdraw_runtime_revision','revoke_workload_token','isolate_environment','quarantine_event') NOT NULL,
	`actionState` enum('pending','applied','failed','reverted') NOT NULL DEFAULT 'pending',
	`evidenceRef` varchar(256),
	`targetRef` varchar(256),
	`detailsJson` text,
	`failureReason` text,
	`appliedAt` datetime(3),
	`revertedAt` datetime(3),
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `IncidentContainment_id` PRIMARY KEY(`id`),
	CONSTRAINT `IncidentContainment_incident_action_uq` UNIQUE(`incidentId`,`actionType`)
);
--> statement-breakpoint
CREATE TABLE `SecurityIncident` (
	`id` varchar(36) NOT NULL,
	`tenantId` varchar(36) NOT NULL,
	`incidentKey` varchar(128) NOT NULL,
	`severity` enum('low','medium','high','critical') NOT NULL,
	`incidentState` enum('open','investigating','contained','resolved','escalated') NOT NULL DEFAULT 'open',
	`targetType` enum('agent','agent_revision','tool_provider','tool','credential','runtime','environment','workload_token','other') NOT NULL,
	`targetId` varchar(128) NOT NULL,
	`summary` text,
	`detectedBy` varchar(64) NOT NULL,
	`detectedAt` datetime(3) NOT NULL,
	`investigatingAt` datetime(3),
	`containedAt` datetime(3),
	`resolvedAt` datetime(3),
	`closedBy` varchar(128),
	`closureReason` text,
	`containmentSummaryJson` text,
	`auditEventId` varchar(36),
	`requestId` varchar(64),
	`createdAt` datetime(3) NOT NULL,
	`updatedAt` datetime(3) NOT NULL,
	CONSTRAINT `SecurityIncident_id` PRIMARY KEY(`id`),
	CONSTRAINT `SecurityIncident_tenant_key_uq` UNIQUE(`tenantId`,`incidentKey`)
);
--> statement-breakpoint
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `AuthSession` ADD CONSTRAINT `AuthSession_userIdentityId_UserIdentity_id_fk` FOREIGN KEY (`userIdentityId`) REFERENCES `UserIdentity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `EnterpriseProfileSyncState` ADD CONSTRAINT `EnterpriseProfileSyncState_userIdentityId_UserIdentity_id_fk` FOREIGN KEY (`userIdentityId`) REFERENCES `UserIdentity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `LocalCredential` ADD CONSTRAINT `LocalCredential_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `LocalCredential` ADD CONSTRAINT `LocalCredential_userIdentityId_UserIdentity_id_fk` FOREIGN KEY (`userIdentityId`) REFERENCES `UserIdentity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PrincipalBinding` ADD CONSTRAINT `PrincipalBinding_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PrincipalBinding` ADD CONSTRAINT `PrincipalBinding_userIdentityId_UserIdentity_id_fk` FOREIGN KEY (`userIdentityId`) REFERENCES `UserIdentity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `UserExtensionAttribute` ADD CONSTRAINT `UserExtensionAttribute_userIdentityId_UserIdentity_id_fk` FOREIGN KEY (`userIdentityId`) REFERENCES `UserIdentity`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `UserIdentity` ADD CONSTRAINT `UserIdentity_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionGroup` ADD CONSTRAINT `PermissionGroup_principalId_PrincipalBinding_id_fk` FOREIGN KEY (`principalId`) REFERENCES `PrincipalBinding`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionGroup` ADD CONSTRAINT `PermissionGroup_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionGroupMember` ADD CONSTRAINT `PermissionGroupMember_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionGroupMember` ADD CONSTRAINT `PermissionGroupMember_groupId_PermissionGroup_principalId_fk` FOREIGN KEY (`groupId`) REFERENCES `PermissionGroup`(`principalId`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionRole` ADD CONSTRAINT `PermissionRole_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionRoleAssignment` ADD CONSTRAINT `PermissionRoleAssignment_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `PermissionRoleAssignment` ADD CONSTRAINT `PermissionRoleAssignment_principalId_PrincipalBinding_id_fk` FOREIGN KEY (`principalId`) REFERENCES `PrincipalBinding`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `ResourceAccessPolicy` ADD CONSTRAINT `ResourceAccessPolicy_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `RoleActionBinding` ADD CONSTRAINT `RoleActionBinding_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `RoleActionBinding` ADD CONSTRAINT `RoleActionBinding_principalBindingId_PrincipalBinding_id_fk` FOREIGN KEY (`principalBindingId`) REFERENCES `PrincipalBinding`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `DeletionRequest` ADD CONSTRAINT `DeletionRequest_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `DeletionStep` ADD CONSTRAINT `DeletionStep_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `DeletionStep` ADD CONSTRAINT `DeletionStep_requestId_DeletionRequest_id_fk` FOREIGN KEY (`requestId`) REFERENCES `DeletionRequest`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `LegalHold` ADD CONSTRAINT `LegalHold_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `RetentionPolicy` ADD CONSTRAINT `RetentionPolicy_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `IncidentContainment` ADD CONSTRAINT `IncidentContainment_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `IncidentContainment` ADD CONSTRAINT `IncidentContainment_incidentId_SecurityIncident_id_fk` FOREIGN KEY (`incidentId`) REFERENCES `SecurityIncident`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE `SecurityIncident` ADD CONSTRAINT `SecurityIncident_tenantId_Tenant_id_fk` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX `AuthSession_user_expiry_idx` ON `AuthSession` (`tenantId`,`userIdentityId`,`expiresAt`);--> statement-breakpoint
CREATE INDEX `PrincipalBinding_tenant_user_idx` ON `PrincipalBinding` (`tenantId`,`userIdentityId`);--> statement-breakpoint
CREATE INDEX `UserExtensionAttribute_user_idx` ON `UserExtensionAttribute` (`userIdentityId`);--> statement-breakpoint
CREATE INDEX `UserIdentity_tenant_email_idx` ON `UserIdentity` (`tenantId`,`email`);--> statement-breakpoint
CREATE INDEX `RoleActionBinding_tenant_principal_idx` ON `RoleActionBinding` (`tenantId`,`principalBindingId`);--> statement-breakpoint
CREATE INDEX `RoleActionBinding_tenant_action_idx` ON `RoleActionBinding` (`tenantId`,`actionCode`);--> statement-breakpoint
CREATE INDEX `DeletionRequest_tenant_subject_idx` ON `DeletionRequest` (`tenantId`,`subjectType`,`subjectId`);--> statement-breakpoint
CREATE INDEX `DeletionRequest_tenant_state_idx` ON `DeletionRequest` (`tenantId`,`requestState`);--> statement-breakpoint
CREATE INDEX `DeletionRequest_tenant_requested_by_idx` ON `DeletionRequest` (`tenantId`,`requestedBy`);--> statement-breakpoint
CREATE INDEX `DeletionStep_tenant_request_idx` ON `DeletionStep` (`tenantId`,`requestId`);--> statement-breakpoint
CREATE INDEX `DeletionStep_request_state_idx` ON `DeletionStep` (`requestId`,`stepState`);--> statement-breakpoint
CREATE INDEX `LegalHold_tenant_state_idx` ON `LegalHold` (`tenantId`,`holdState`);--> statement-breakpoint
CREATE INDEX `LegalHold_valid_until_idx` ON `LegalHold` (`validUntil`);--> statement-breakpoint
CREATE INDEX `RetentionPolicy_tenant_data_class_idx` ON `RetentionPolicy` (`tenantId`,`dataClass`);--> statement-breakpoint
CREATE INDEX `IncidentContainment_tenant_incident_idx` ON `IncidentContainment` (`tenantId`,`incidentId`);--> statement-breakpoint
CREATE INDEX `IncidentContainment_incident_state_idx` ON `IncidentContainment` (`incidentId`,`actionState`);--> statement-breakpoint
CREATE INDEX `SecurityIncident_tenant_state_idx` ON `SecurityIncident` (`tenantId`,`incidentState`);--> statement-breakpoint
CREATE INDEX `SecurityIncident_tenant_target_idx` ON `SecurityIncident` (`tenantId`,`targetType`,`targetId`);--> statement-breakpoint
CREATE INDEX `SecurityIncident_tenant_severity_idx` ON `SecurityIncident` (`tenantId`,`severity`);--> statement-breakpoint
CREATE INDEX `SecurityIncident_tenant_detected_idx` ON `SecurityIncident` (`tenantId`,`detectedAt`);