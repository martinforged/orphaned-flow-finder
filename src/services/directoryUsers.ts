import { Office365UsersService } from "../generated/services/Office365UsersService";
import type {
  GraphUser_V1,
  User,
} from "../generated/models/Office365UsersModel";

const DIRECTORY_LOOKUP_BATCH_SIZE = 8;
const DIRECTORY_PROFILE_FIELDS =
  "id,displayName,userPrincipalName,mail,accountEnabled";
const DIRECTORY_SEARCH_LIMIT = 25;

export type OwnerStatus =
  | "active"
  | "disabled"
  | "orphaned"
  | "unknown"
  | "missing";

export interface DirectoryUser {
  id: string;
  displayName: string;
  userPrincipalName?: string;
  mail?: string;
  accountEnabled: boolean;
}

export interface OwnerValidation {
  id?: string;
  status: OwnerStatus;
  displayName: string;
  userPrincipalName?: string;
  mail?: string;
  error?: string;
}

type ValidationProgressHandler = (completed: number, total: number) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    isRecord(error) &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "The directory connector returned an unknown error.";
}

function getHttpStatus(error: unknown): number | undefined {
  if (
    isRecord(error) &&
    "status" in error &&
    typeof error.status === "number"
  ) {
    return error.status;
  }

  return undefined;
}

function isDirectoryNotFound(error: unknown): boolean {
  const message = getErrorMessage(error).toLowerCase();
  return (
    getHttpStatus(error) === 404 ||
    message.includes("request_resourcenotfound") ||
    message.includes("resource not found") ||
    message.includes("does not exist or one of its queried reference")
  );
}

function mapProfile(
  requestedId: string,
  profile: GraphUser_V1,
): OwnerValidation {
  const id = profile.id?.trim() || requestedId;
  const accountEnabled = profile.accountEnabled !== false;

  return {
    id,
    status: accountEnabled ? "active" : "disabled",
    displayName:
      profile.displayName?.trim() ||
      profile.userPrincipalName?.trim() ||
      id,
    userPrincipalName: profile.userPrincipalName?.trim() || undefined,
    mail: profile.mail?.trim() || undefined,
  };
}

async function validateOwner(ownerId: string): Promise<OwnerValidation> {
  try {
    const result = await Office365UsersService.UserProfile_V2(
      ownerId,
      DIRECTORY_PROFILE_FIELDS,
    );

    if (result.success) {
      if (!result.data) {
        return {
          id: ownerId,
          status: "unknown",
          displayName: "Directory lookup incomplete",
          error: "The directory returned a successful response without a user.",
        };
      }
      return mapProfile(ownerId, result.data);
    }

    if (isDirectoryNotFound(result.error)) {
      return {
        id: ownerId,
        status: "orphaned",
        displayName: "Deleted user",
      };
    }

    return {
      id: ownerId,
      status: "unknown",
      displayName: "Directory lookup failed",
      error: getErrorMessage(result.error),
    };
  } catch (error) {
    return {
      id: ownerId,
      status: "unknown",
      displayName: "Directory lookup failed",
      error: getErrorMessage(error),
    };
  }
}

export async function validateOwnerIds(
  ownerIds: string[],
  onProgress: ValidationProgressHandler,
): Promise<Map<string, OwnerValidation>> {
  const uniqueOwnerIds = Array.from(
    new Set(
      ownerIds
        .map((ownerId) => ownerId.trim())
        .filter(Boolean)
        .map((ownerId) => ownerId.toLowerCase()),
    ),
  );
  const validations = new Map<string, OwnerValidation>();
  let completed = 0;

  for (
    let offset = 0;
    offset < uniqueOwnerIds.length;
    offset += DIRECTORY_LOOKUP_BATCH_SIZE
  ) {
    const batch = uniqueOwnerIds.slice(
      offset,
      offset + DIRECTORY_LOOKUP_BATCH_SIZE,
    );
    const batchResults = await Promise.all(
      batch.map(async (ownerId) => ({
        ownerId,
        validation: await validateOwner(ownerId),
      })),
    );

    for (const { ownerId, validation } of batchResults) {
      validations.set(ownerId, validation);
      completed += 1;
    }
    onProgress(completed, uniqueOwnerIds.length);
  }

  return validations;
}

function mapSearchResult(user: User): DirectoryUser | undefined {
  const id = user.Id?.trim();
  if (!id) {
    return undefined;
  }

  return {
    id,
    displayName:
      user.DisplayName?.trim() ||
      user.UserPrincipalName?.trim() ||
      user.Mail?.trim() ||
      id,
    userPrincipalName: user.UserPrincipalName?.trim() || undefined,
    mail: user.Mail?.trim() || undefined,
    accountEnabled: user.AccountEnabled !== false,
  };
}

export async function searchDirectoryUsers(
  searchTerm: string,
): Promise<DirectoryUser[]> {
  const normalizedSearch = searchTerm.trim();
  if (normalizedSearch.length < 2) {
    throw new Error(
      "Enter at least two characters of a name or email address.",
    );
  }

  const result = await Office365UsersService.SearchUserV2(
    normalizedSearch,
    DIRECTORY_SEARCH_LIMIT,
    true,
  );

  if (!result.success) {
    throw new Error(
      `Directory search failed: ${getErrorMessage(result.error)}`,
    );
  }

  const users = (result.data?.value ?? [])
    .map(mapSearchResult)
    .filter((user): user is DirectoryUser => Boolean(user))
    .filter((user) => user.accountEnabled);

  return Array.from(
    new Map(users.map((user) => [user.id.toLowerCase(), user])).values(),
  ).sort((left, right) =>
    left.displayName.localeCompare(right.displayName, undefined, {
      sensitivity: "base",
    }),
  );
}
