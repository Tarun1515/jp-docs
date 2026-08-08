# COMPLETE TABLE STRUCTURE — ALL 3 DATABASES

> Client spec ke har field ko cover karta hai. Ye final list hai.
> Standard columns (`Is_Active, Is_Deleted, CreatedOn, CreatedBy, ModifiedOn, ModifiedBy`) har table pe implied hain — neeche repeat nahi kiye.

---

# DB 1 — `jp_sso` (Identity)

## Masters (7)
| Table | Seed values |
|---|---|
| `m_sso_user_types` | 1=Admin, 2=School, 3=Teacher |
| `m_sso_user_status` | 1=PendingApproval, 2=Active, 3=Rejected, 4=Suspended, 5=Locked, 6=ResubmitRequired |
| `m_sso_hash_algorithms` | 1=PBKDF2-SHA256 (+ `DefaultIterations` col) |
| `m_sso_token_types` | 1=Refresh, 2=PasswordReset, 3=EmailVerify, 4=Invite |
| `m_sso_otp_channels` | 1=Email, 2=SMS |
| `m_sso_lock_reasons` | 1=FailedAttempts, 2=AdminSuspend |
| `m_sso_modules` | Auth, Users, Jobs, Applicants, Branches, Verification, Reports, Moderation, CMS, Settings |

## Transactional (10)

**`t_sso_users`**
`UserId` bigint PK · `UserUid` uniqueidentifier UNIQUE · `UserTypeId` · `StatusId` · `Email` nvarchar(150) · `Mobile` varchar(15) · `IsEmailVerified` bit · `IsMobileVerified` bit · `OrganizationUid` uniqueidentifier NULL · `CreatedByUserId` bigint NULL · `LastLoginOn` · `LastPasswordChangeOn` · `FailedAttemptCount` int · `RowVersion`
> Unique filtered index on Email/Mobile WHERE `Is_Deleted=0`

**`t_sso_user_credentials`**
`CredentialId` · `UserId` · `PasswordHash` varbinary(64) · `PasswordSalt` varbinary(32) · `HashAlgorithmId` · `Iterations` int · `IsCurrent` bit · `CreatedOn` · `ExpiresOn` NULL

**`t_sso_user_tokens`**
`TokenId` · `UserId` · `TokenTypeId` · `TokenHash` varchar(128) · `ExpiresOn` · `UsedOn` NULL · `RevokedOn` NULL · `ReplacedByTokenId` NULL · `IpAddress` · `UserAgent`

**`t_sso_user_otps`**
`OtpId` · `UserId` · `OtpChannelId` · `OtpHash` · `SentTo` · `ExpiresOn` · `AttemptCount` · `IsVerified` · `VerifiedOn`

**`t_sso_user_login_attempts`**
`AttemptId` · `UserId` NULL · `LoginIdentifier` · `IpAddress` · `UserAgent` · `IsSuccess` bit · `FailureReason` · `AttemptedOn`

**`t_sso_user_lockouts`**
`LockoutId` · `UserId` · `LockReasonId` · `LockedOn` · `UnlockOn` · `UnlockedByUserId` NULL · `Remarks`

**`t_sso_roles`**
`RoleId` · `RoleCode` · `RoleName` · `UserTypeId` · `IsSystemRole` bit · `OrganizationUid` NULL (NULL=global, value=school custom role)

**`t_sso_permissions`**
`PermissionId` · `ModuleId` · `PermissionCode` · `PermissionName`

**`t_sso_role_permissions`**
`RolePermissionId` · `RoleId` · `PermissionId`

**`t_sso_user_roles`**
`UserRoleId` · `UserId` · `RoleId` · `OrganizationUid` NULL · `AssignedByUserId` · `AssignedOn` · `ValidFrom` · `ValidTo` NULL

### Seed roles
| Code | UserType |
|---|---|
| `SUPER_ADMIN` | 1 |
| `VERIFICATION_ADMIN` | 1 |
| `MODERATION_ADMIN` | 1 |
| `SCHOOL_OWNER` | 2 |
| `SENIOR_HR` | 2 |
| `HR` | 2 |
| `SCHOOL_VIEWER` | 2 |
| `TEACHER` | 3 |

### Seed permissions (module.action)
`JOB.CREATE` `JOB.EDIT` `JOB.PUBLISH` `JOB.CLOSE` `JOB.VIEW` ·
`APPLICANT.VIEW` `APPLICANT.SHORTLIST` `APPLICANT.REJECT` `RESUME.DOWNLOAD` ·
`OFFER.CREATE` `OFFER.APPROVE` ·
`BRANCH.MANAGE` `USER.MANAGE` `PROFILE.EDIT` ·
`TEACHER_SEARCH.VIEW` `TEACHER_SEARCH.INVITE` ·
`VERIFICATION.SCHOOL` `VERIFICATION.TEACHER` `MODERATION.JOB` `MODERATION.REPORT` ·
`CMS.MANAGE` `REPORT.VIEW` `SETTINGS.MANAGE`

---

# DB 2 — `jp_mdm` (Masters + Approval)

## Geography masters (4)
`m_mdm_country` · `m_mdm_state` (CountryId) · `m_mdm_district` (StateId) · `m_mdm_city` (DistrictId, `Latitude`, `Longitude`)

## Education masters (7)
| Table | Notes / seed |
|---|---|
| `m_mdm_board` | CBSE, ICSE, State Board, IB, IGCSE, NIOS |
| `m_mdm_school_type` | ⭐NEW — Private, Government, Government-Aided, International, Convent |
| `m_mdm_qualification` | B.Ed, M.Ed, B.A, M.A, B.Sc, M.Sc, PhD, NET, TET, CTET, D.El.Ed |
| `m_mdm_subject` | Maths, Physics, English, Hindi… |
| `m_mdm_designation` | PRT, TGT, PGT, Principal, Vice Principal, Coordinator, Librarian, Sports |
| `m_mdm_class_level` | Pre-Primary, Primary(I-V), Middle(VI-VIII), Secondary(IX-X), Sr.Secondary(XI-XII) |
| `m_mdm_stream` | Science, Commerce, Arts |

## Profile masters (5)
| Table | Notes |
|---|---|
| `m_mdm_gender` | Male, Female, Other |
| `m_mdm_skill` | ⭐NEW — Classroom Mgmt, Smart Board, Lesson Planning, Counselling… |
| `m_mdm_language` | ⭐NEW — English, Hindi, Punjabi, Sanskrit… |
| `m_mdm_facility` | ⭐NEW — Library, Lab, Playground, Transport, Hostel, Smart Class, AC |
| `m_mdm_experience_range` | 0-1, 1-3, 3-5, 5-10, 10+ (search filter ke liye) |

## Approval & payment masters (7)
| Table | Seed |
|---|---|
| `m_mdm_request_types` | 1=SCHOOL_REG, 2=TEACHER_VERIFY, 3=BRANCH_ADD, 4=OFFER_APPROVAL |
| `m_mdm_approval_status` | 1=Pending, 2=Rejected, 3=Approved, 4=ResubmitRequired, 8=Draft |
| `m_mdm_action_types` | 1=Approve, 2=Reject, 3=RequestResubmit, 4=Submit, 5=Resubmit |
| `m_mdm_document_types` | RequestTypeId, `IsMandatory`, `MaxSizeKb`, `AllowedExtensions` |
| `m_mdm_rejection_reasons` | RequestTypeId-scoped |
| `m_mdm_payment_modes` | Online, NEFT, Cheque, Cash |
| `m_mdm_payment_status` | Pending, Success, Failed, Refunded |

**Document types seed:** School → RegistrationCertificate, AffiliationLetter, AuthorizationLetter, PAN, GST · Teacher → DegreeCertificate, IdProof, ExperienceLetter, TETCertificate

## Transactional (8)

**`t_mdm_request_levels`**
`LevelId` · `RequestTypeId` · `LevelNumber` tinyint · `RoleId` · `OrganizationUid` NULL · `IsFinalLevel` bit

**`t_mdm_approval_requests`**
`RequestId` · `RequestNo` varchar(30) · `RequestTypeId` · `EntityUid` · `OrganizationUid` NULL · `RequestorUserId` · `CurrentApprovalLevel` tinyint · `StatusId` · `ApproverUserId` NULL · `SubmittedOn` · `CompletedOn` · `RowVersion`

**`t_mdm_request_approvals`** *(append-only)*
`ApprovalId` · `RequestId` · `LevelNumber` · `ActionTypeId` · `ActionByUserId` · `Remarks` nvarchar(1000) · `ActionOn` · `IpAddress`

**`t_mdm_request_documents`**
`DocumentId` · `RequestId` · `DocumentTypeId` · `FilePath` · `FileName` · `FileSizeKb` · `MimeType` · `Version` int · `IsVerified` bit · `VerifiedByUserId` · `VerifiedOn` · `RejectionReasonId` NULL · `Remarks`

**`t_mdm_request_payments`** *(table banao, MVP mein use nahi)*
`PaymentId` · `RequestId` · `PlanId` · `Amount` decimal(18,2) · `PaymentModeId` · `GatewayRefNo` · `PaymentStatusId` · `PaidOn` · `VerifiedByUserId`

**`t_mdm_school_registration_details`** ⭐ *spec point 6 ke sab fields*
`RequestId` PK · `SchoolName` · `SchoolTypeId`⭐ · `BoardId` · `AffiliationNumber` · `RegistrationNo` · `LogoPath`⭐ · `GroupType` tinyint · `EstablishedYear`⭐ · `AddressLine1` · `AddressLine2` · `CityId` · `DistrictId` · `StateId` · `Pincode` · `PrincipalName`⭐ · `PrincipalMobile`⭐ · `HrContactName`⭐ · `HrContactMobile`⭐ · `ContactEmail` · `ContactMobile` · `Website`⭐ · `AboutSchool`⭐

**`t_mdm_teacher_registration_details`**
`RequestId` PK · `FullName` · `DOB` · `GenderId` · `QualificationId` · `TotalExperienceMonths` · `CurrentCityId` · `CurrentStateId` · `CurrentSchool`⭐

**`t_mdm_teacher_registration_subjects`**
`Id` · `RequestId` · `SubjectId`

---

# DB 3 — `jp_app` (Business)

## Masters (7)
| Table | Seed |
|---|---|
| `m_app_job_status` | 1=Draft, 2=Active, 3=Expired, 4=Closed |
| `m_app_application_status` | 1=Applied, 2=Viewed, 3=Shortlisted, 4=Interview, 5=Selected, 6=Rejected, 7=OfferSent, 8=OfferAccepted, 9=OfferDeclined, 10=Hired |
| `m_app_employment_types` | ⭐ Full-time, Part-time, Contract, Visiting, Temporary |
| `m_app_notification_types` | ⭐ ApplicationSubmitted, ApplicationViewed, Shortlisted, Selected, Rejected, OfferReceived, NewApplication, InviteReceived, VerificationApproved, VerificationRejected |
| `m_app_report_reasons` | ⭐ FakeJob, FakeProfile, MisleadingInfo, Spam, InappropriateContent, FraudPayment, Other |
| `m_app_report_status` | ⭐ 1=Open, 2=UnderReview, 3=ActionTaken, 4=Dismissed |
| `m_app_cms_page_types` | ⭐ Home, About, Contact, FAQ, Terms, Privacy, HowItWorksTeacher, HowItWorksSchool |

## School tables (6)

**`t_app_schools`**
`SchoolId` · `SchoolUid` · `OrganizationUid` · `SchoolName` · `SchoolTypeId`⭐ · `BoardId` · `AffiliationNumber` · `RegistrationNo` · `LogoPath`⭐ · `GroupType` · `EstablishedYear`⭐ · `AboutSchool`⭐ · `Website`⭐ · `ContactEmail` · `ContactMobile` · `PrincipalName`⭐ · `HrContactName`⭐ · `HrContactMobile`⭐ · `IsVerified` bit⭐ · `VerifiedOn`⭐ · `VerifiedByUserId`⭐ · `IsSuspended` bit⭐ · `SuspendedOn` · `SuspensionReason` · `RowVersion`

**`t_app_school_branches`**
`BranchId` · `SchoolId` · `BranchName` · `BranchCode` · `AddressLine1` · `AddressLine2` · `CityId` · `DistrictId` · `StateId` · `Pincode` · `Latitude` · `Longitude` · `ContactPerson` · `Phone` · `Email` · `IsHeadOffice` bit

**`t_app_school_photos`** ⭐ — `PhotoId` · `SchoolId` · `BranchId` NULL · `FilePath` · `Caption` · `DisplayOrder`

**`t_app_school_facilities`** ⭐ — `Id` · `SchoolId` · `BranchId` NULL · `FacilityId`

**`t_app_school_users`** — `SchoolUserId` · `SchoolId` · `UserUid` · `RoleInSchool` tinyint (1=Owner, 2=SeniorHR, 3=HR, 4=Viewer) · `DesignationText`

**`t_app_school_user_branches`** — `Id` · `SchoolUserId` · `BranchId`

## Teacher tables (7)

**`t_app_teachers`**
`TeacherId` · `TeacherUid` · `UserUid` · `FullName` · `PhotoPath`⭐ · `DOB` · `GenderId` · `QualificationId` · `HighestQualificationText` · `DesignationId` · `TotalExperienceMonths` · `CurrentSchool`⭐ · `LastSchool`⭐ · `ExpectedSalaryMin`⭐ · `ExpectedSalaryMax`⭐ · `CurrentCityId` · `CurrentStateId` · `AboutMe` · `ResumePath` · `IsVerified` bit⭐ · `VerifiedOn`⭐ · `IsSuspended` bit⭐ · `ProfileCompletionPercent`⭐ · `RowVersion`

**`t_app_teacher_subjects`** — `Id` · `TeacherId` · `SubjectId`
**`t_app_teacher_class_levels`** ⭐ — `Id` · `TeacherId` · `ClassLevelId`
**`t_app_teacher_skills`** ⭐ — `Id` · `TeacherId` · `SkillId`
**`t_app_teacher_languages`** ⭐ — `Id` · `TeacherId` · `LanguageId` · `ProficiencyLevel`
**`t_app_teacher_preferred_locations`** — `Id` · `TeacherId` · `CityId` · `StateId` · `PreferenceOrder`
**`t_app_teacher_documents`** ⭐ — `DocumentId` · `TeacherId` · `DocumentTypeId` · `FilePath` · `FileName` · `FileSizeKb` · `MimeType` · `IsVerified` · `VerifiedOn`
**`t_app_teacher_experiences`** ⭐ — `Id` · `TeacherId` · `SchoolName` · `DesignationId` · `SubjectId` · `FromDate` · `ToDate` · `IsCurrent` bit

## Job tables (4)

**`t_app_jobs`** ⭐ *spec point 6 ke sab fields*
`JobId` · `JobUid` · `SchoolId` · `BranchId` NOT NULL · `JobTitle` · `SubjectId` · `DesignationId` · `NoOfVacancies`⭐ · `QualificationId` · `MinExperienceMonths` · `MaxExperienceMonths` · `SalaryMin` · `SalaryMax` · `IsSalaryNegotiable` bit · `EmploymentTypeId`⭐ · `CityId` · `StateId` · `WorkingDays`⭐ nvarchar(100) · `TimingFrom`⭐ time · `TimingTo`⭐ time · `LastDateToApply`⭐ · `ExpectedJoiningDate`⭐ · `JobDescription` nvarchar(max) · `JobStatusId` · `PublishedOn` · `ClosedOn` · `ViewCount` · `ApplicationCount` · `RowVersion`

**`t_app_job_subjects`** — `Id` · `JobId` · `SubjectId` (multi-subject job)
**`t_app_job_class_levels`** ⭐ — `Id` · `JobId` · `ClassLevelId`
**`t_app_job_moderation_log`** ⭐ — `LogId` · `JobId` · `ActionByUserId` · `ActionType` · `Remarks` · `ActionOn`

## Application & Offer tables (4)

**`t_app_applications`**
`ApplicationId` · `ApplicationUid` · `JobId` · `SchoolId` · `BranchId` · `TeacherId` · `ApplicationStatusId` · `AppliedOn` · `ViewedOn` · `ResumePathSnapshot` (apply ke waqt ka resume) · `CoverNote` · `RejectionReason` · `RowVersion`
> UNIQUE index `(JobId, TeacherId)` WHERE `Is_Deleted=0` — duplicate apply block

**`t_app_application_status_history`** — `HistoryId` · `ApplicationId` · `FromStatusId` · `ToStatusId` · `ChangedByUserId` · `Remarks` · `ChangedOn`

**`t_app_offers`** *(Offer Lite)*
`OfferId` · `OfferUid` · `ApplicationId` · `SchoolId` · `BranchId` · `TeacherId` · `DesignationId` · `OfferedSalary` · `JoiningDate` · `ReportingTime` · `TermsAndConditions` nvarchar(max) · `OfferStatusId` (Sent/Accepted/Declined/Withdrawn) · `SentOn` · `RespondedOn` · `TeacherRemarks`

**`t_app_teacher_invites`** ⭐ *(school bina job post kiye invite bheje)*
`InviteId` · `SchoolId` · `BranchId` · `TeacherId` · `JobId` NULL · `InvitedByUserId` · `Message` · `InviteStatus` (Sent/Viewed/Applied/Ignored) · `SentOn` · `RespondedOn`

## Notification tables (2) ⭐

**`t_app_notifications`** — `NotificationId` · `NotificationTypeId` · `RecipientUserUid` · `Title` · `Body` · `RefEntityType` · `RefEntityId` · `ActionUrl` · `IsRead` bit · `ReadOn` · `CreatedOn`
**`t_app_notification_delivery_log`** — `LogId` · `NotificationId` · `Channel` (InApp/Email/SMS) · `SentTo` · `IsSent` · `SentOn` · `FailureReason`

## Report / Moderation tables (2) ⭐

**`t_app_reports`** — `ReportId` · `ReportReasonId` · `ReportedEntityType` (School/Teacher/Job) · `ReportedEntityId` · `ReportedByUserUid` · `Description` · `ReportStatusId` · `ReviewedByUserId` · `ReviewedOn` · `ActionTaken` · `AdminRemarks`
**`t_app_user_suspensions`** — `SuspensionId` · `TargetUserUid` · `EntityType` · `ReasonText` · `SuspendedByUserId` · `SuspendedOn` · `RevokedOn` · `RevokedByUserId`

## CMS & Featured tables (5) ⭐

**`t_app_cms_pages`** — `PageId` · `PageTypeId` · `Title` · `Slug` · `Content` nvarchar(max) · `MetaTitle` · `MetaDescription` · `IsPublished`
**`t_app_cms_content_blocks`** — `BlockId` · `PageId` · `BlockKey` · `BlockTitle` · `BlockContent` · `ImagePath` · `DisplayOrder`
**`t_app_faqs`** — `FaqId` · `Category` (Teacher/School/General) · `Question` · `Answer` · `DisplayOrder`
**`t_app_featured_jobs`** — `Id` · `JobId` · `FromDate` · `ToDate` · `DisplayOrder` · `CreatedBy`
**`t_app_featured_schools`** — `Id` · `SchoolId` · `FromDate` · `ToDate` · `DisplayOrder` · `CreatedBy`

## Support tables (2) ⭐

**`t_app_contact_enquiries`** — `EnquiryId` · `Name` · `Email` · `Mobile` · `Subject` · `Message` · `IsResolved` · `ResolvedByUserId` · `ResolvedOn`
**`t_app_saved_jobs`** — `Id` · `TeacherId` · `JobId` · `SavedOn`

---

## TOTAL COUNT

| DB | Masters | Transactional | Total |
|---|---|---|---|
| `jp_sso` | 7 | 10 | **17** |
| `jp_mdm` | 23 | 8 | **31** |
| `jp_app` | 7 | 32 | **39** |
| | | | **87 tables** |

⭐ = client spec audit ke baad naya add hua
