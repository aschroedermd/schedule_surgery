import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Copy, Eye, KeyRound, LogOut, Pencil, Plus, Save, Send, Trash2, Users } from "lucide-react";
import {
  changeMyPassword,
  createUser,
  createUsers,
  deleteUser,
  fetchUsers,
  resetUserPassword,
  updateUser
} from "./api";
import type { PasswordChangeResponse } from "./api";
import { Attending, Role, ServicePrivilege, ServicePrivileges, UserSummary } from "../shared/types";

type AddPrivilegePreset = "view" | "request" | "edit" | "custom" | "clone";

export function UsersTab({
  token,
  serviceLines,
  attendings,
  onToast
}: {
  token: string;
  serviceLines: string[];
  attendings: Attending[];
  onToast: (message: string) => void;
}) {
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserSummary>>({});
  const [temporaryPasswords, setTemporaryPasswords] = useState<Record<string, string>>({});
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [addDraft, setAddDraft] = useState<{
    entries: string;
    temporaryPassword: string;
    attendingId: string;
    role: Role;
    preset: AddPrivilegePreset;
    cloneFrom: string;
    servicePrivileges: ServicePrivileges;
  }>({
    entries: "",
    temporaryPassword: "",
    attendingId: "",
    role: "viewer",
    preset: "view",
    cloneFrom: "",
    servicePrivileges: buildPrivileges(serviceLines, "view")
  });
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    setDrafts(Object.fromEntries(users.map((user) => [user.username, user])));
  }, [users]);

  useEffect(() => {
    let cancelled = false;
    setLoadingUsers(true);
    setError(undefined);
    fetchUsers(token)
      .then((nextUsers) => {
        if (!cancelled) setUsers(nextUsers);
      })
      .catch((fetchError) => {
        if (!cancelled) setError(fetchError instanceof Error ? fetchError.message : "User list failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoadingUsers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    setAddDraft((current) => ({
      ...current,
      servicePrivileges: normalizePrivilegesForServices(current.servicePrivileges, serviceLines)
    }));
  }, [serviceLines]);

  async function addUser(event: FormEvent) {
    event.preventDefault();
    await runUsersAction(async () => {
      const entries = parseUserEntries(addDraft.entries);
      if (entries.length === 0) throw new Error("Enter at least one username");
      const servicePrivileges = resolveAddPrivileges();
      const payload = entries.map((entry) => ({
        ...entry,
        role: addDraft.role,
        attendingId: addDraft.role === "attending" ? addDraft.attendingId : undefined,
        temporaryPassword: addDraft.temporaryPassword.trim() || undefined,
        servicePrivileges
      }));
      const result =
        payload.length === 1
          ? await createUser(token, payload[0])
          : await createUsers(token, payload);
      const created = "created" in result ? result.created : [{ user: result.user, temporaryPassword: result.temporaryPassword }];
      setUsers(result.users);
      setTemporaryPasswords((current) => ({
        ...current,
        ...Object.fromEntries(
          created
            .filter((creation) => creation.temporaryPassword)
            .map((creation) => [creation.user.username, creation.temporaryPassword as string])
        )
      }));
      setAddDraft((current) => ({ ...current, entries: "", temporaryPassword: "" }));
      onToast(`${created.length} user${created.length === 1 ? "" : "s"} added`);
    });
  }

  async function saveUser(username: string) {
    const draft = drafts[username];
    if (!draft) return;
    await runUsersAction(async () => {
      setUsers(
        await updateUser(token, username, {
          displayName: draft.displayName,
          role: draft.role,
          attendingId: draft.attendingId,
          servicePrivileges: draft.servicePrivileges
        })
      );
      onToast("User saved");
    });
  }

  async function resetPassword(username: string) {
    await runUsersAction(async () => {
      const result = await resetUserPassword(token, username);
      setUsers(result.users);
      setTemporaryPasswords((current) => ({ ...current, [username]: result.temporaryPassword }));
      onToast("Temporary password generated");
    });
  }

  async function removeUser(username: string) {
    if (!window.confirm(`Delete ${username}?`)) return;
    await runUsersAction(async () => {
      setUsers(await deleteUser(token, username));
      setTemporaryPasswords((current) => {
        const next = { ...current };
        delete next[username];
        return next;
      });
      onToast("User deleted");
    });
  }

  async function runUsersAction(action: () => Promise<void>) {
    try {
      setError(undefined);
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "User action failed");
    }
  }

  function copyTemporaryPasswords() {
    const lines = Object.entries(temporaryPasswords).map(([username, password]) => `${username}: ${password}`);
    void navigator.clipboard.writeText(lines.join("\n"));
    onToast("Temporary passwords copied");
  }

  function resolveAddPrivileges(): ServicePrivileges {
    if (addDraft.role === "admin") return buildPrivileges(serviceLines, "edit");
    if (addDraft.preset === "clone") {
      const cloneSource = users.find((user) => user.username === (addDraft.cloneFrom || users[0]?.username));
      return cloneSource ? normalizePrivilegesForServices(cloneSource.servicePrivileges, serviceLines) : buildPrivileges(serviceLines, "view");
    }
    if (addDraft.preset === "custom") return normalizePrivilegesForServices(addDraft.servicePrivileges, serviceLines);
    return buildPrivileges(serviceLines, addDraft.preset);
  }

  return (
    <section className="users-panel">
      <div className="users-header">
        <div>
          <p className="eyebrow">Access</p>
          <h2>Users</h2>
        </div>
      </div>

      {error && <div className="alert danger">{error}</div>}
      {loadingUsers && <div className="alert">Loading users...</div>}

      {Object.keys(temporaryPasswords).length > 0 && (
        <section className="temporary-password-panel" aria-label="Temporary passwords">
          <div className="temporary-password-header">
            <strong>Temporary passwords</strong>
            <button type="button" className="secondary-button" onClick={copyTemporaryPasswords}>
              <Copy size={15} />
              Copy All
            </button>
          </div>
          <div className="temporary-password-list">
            {Object.entries(temporaryPasswords).map(([username, password]) => (
              <span key={username}>
                <b>{username}</b>
                <code className="temporary-password">{password}</code>
              </span>
            ))}
          </div>
        </section>
      )}

      <form className="user-add-form" onSubmit={addUser}>
        <label className="usernames-field">
          Users
          <textarea
            aria-label="New users"
            value={addDraft.entries}
            placeholder={"jsmith\napatel, Anika Patel"}
            onChange={(event) => setAddDraft({ ...addDraft, entries: event.target.value })}
          />
        </label>
        <label>
          Role
          <select
            value={addDraft.role}
            onChange={(event) => setAddDraft({ ...addDraft, role: event.target.value as Role })}
          >
            <option value="viewer">user</option>
            <option value="medical-student">medical student</option>
            <option value="attending">attending</option>
            <option value="admin">admin</option>
          </select>
        </label>
        {addDraft.role === "attending" && (
          <label>
            Attending
            <select
              aria-label="Linked attending"
              value={addDraft.attendingId}
              required
              onChange={(event) => setAddDraft({ ...addDraft, attendingId: event.target.value })}
            >
              <option value="">Choose attending</option>
              {attendings.map((attending) => <option key={attending.id} value={attending.id}>{attending.name}</option>)}
            </select>
          </label>
        )}
        <label>
          Temporary password
          <input
            aria-label="Temporary password"
            type="password"
            value={addDraft.temporaryPassword}
            placeholder="Leave blank to generate"
            onChange={(event) => setAddDraft({ ...addDraft, temporaryPassword: event.target.value })}
          />
        </label>
        <label>
          Privileges
          <select
            value={addDraft.preset}
            disabled={addDraft.role === "admin"}
            onChange={(event) => setAddDraft({ ...addDraft, preset: event.target.value as AddPrivilegePreset })}
          >
            <option value="view">View only</option>
            <option value="request">Request all</option>
            <option value="edit">Edit all</option>
            <option value="custom">Custom</option>
            <option value="clone">Clone user</option>
          </select>
        </label>
        {addDraft.preset === "clone" && addDraft.role !== "admin" && (
          <label>
            Copy from
            <select
              value={addDraft.cloneFrom || users[0]?.username || ""}
              onChange={(event) => setAddDraft({ ...addDraft, cloneFrom: event.target.value })}
            >
              {users.map((user) => (
                <option key={user.username} value={user.username}>
                  {user.username}
                </option>
              ))}
            </select>
          </label>
        )}
        <button className="primary-button" type="submit" disabled={!addDraft.entries.trim()}>
          <Plus size={16} />
          Add Users
        </button>
        {addDraft.preset === "custom" && addDraft.role !== "admin" && (
          <div className="privilege-grid add-privilege-grid">
            {serviceLines.map((serviceLine) => (
              <label key={serviceLine}>
                <span>{serviceLine}</span>
                <select
                  aria-label={`new users ${serviceLine} privilege`}
                  value={addDraft.servicePrivileges[serviceLine] ?? "view"}
                  onChange={(event) =>
                    setAddDraft({
                      ...addDraft,
                      servicePrivileges: {
                        ...addDraft.servicePrivileges,
                        [serviceLine]: event.target.value as ServicePrivilege
                      }
                    })
                  }
                >
                  <option value="view">view</option>
                  <option value="request">request</option>
                  <option value="edit">edit</option>
                </select>
              </label>
            ))}
          </div>
        )}
      </form>

      <div className="users-table">
        <div className="users-table-head">
          <span>User</span>
          <span>Role</span>
          <span>Privileges</span>
          <span>Password</span>
          <span />
        </div>
        {users.map((user) => {
          const draft = drafts[user.username] ?? user;
          return (
            <article key={user.username} className="user-row">
              <div className="user-identity">
                <strong>{user.username}</strong>
                <input
                  aria-label={`${user.username} display name`}
                  value={draft.displayName}
                  onChange={(event) => updateDraft(user.username, { displayName: event.target.value })}
                />
              </div>
              <label className="user-role-field">
                <span>Role</span>
                <select
                  aria-label={`${user.username} role`}
                  value={draft.role}
                  disabled={user.username === "admin"}
                  onChange={(event) => updateDraft(user.username, { role: event.target.value as Role })}
                >
                  <option value="viewer">user</option>
                  <option value="medical-student">medical student</option>
                  <option value="attending">attending</option>
                  <option value="admin">admin</option>
                </select>
              </label>
              {draft.role === "attending" && (
                <label className="user-role-field">
                  <span>Attending</span>
                  <select
                    aria-label={`${user.username} linked attending`}
                    value={draft.attendingId ?? ""}
                    onChange={(event) => updateDraft(user.username, { attendingId: event.target.value || undefined })}
                  >
                    <option value="">Choose attending</option>
                    {attendings.map((attending) => <option key={attending.id} value={attending.id}>{attending.name}</option>)}
                  </select>
                </label>
              )}
              <div className="user-privileges">
                <div className="privilege-presets" aria-label={`${user.username} bulk privileges`}>
                  <button type="button" className="secondary-button" onClick={() => setAllPrivileges(user.username, "edit")}>
                    <Pencil size={14} />
                    All edit
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setAllPrivileges(user.username, "view")}>
                    <Eye size={14} />
                    All view
                  </button>
                  <button type="button" className="secondary-button" onClick={() => setAllPrivileges(user.username, "request")}>
                    <Send size={14} />
                    All request
                  </button>
                </div>
                <div className="privilege-grid">
                  {serviceLines.map((serviceLine) => (
                    <label key={serviceLine}>
                      <span>{serviceLine}</span>
                      <select
                        aria-label={`${user.username} ${serviceLine} privilege`}
                        value={draft.servicePrivileges[serviceLine] ?? "view"}
                        onChange={(event) =>
                          updatePrivileges(user.username, serviceLine, event.target.value as ServicePrivilege)
                        }
                      >
                        <option value="view">view</option>
                        <option value="request">request</option>
                        <option value="edit">edit</option>
                      </select>
                    </label>
                  ))}
                </div>
              </div>
              <div className="password-reset">
                <span>{user.mustChangePassword ? "Change required" : "Stored as hash"}</span>
                {temporaryPasswords[user.username] && (
                  <code className="temporary-password">{temporaryPasswords[user.username]}</code>
                )}
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => resetPassword(user.username)}
                >
                  <KeyRound size={15} />
                  Reset
                </button>
                {temporaryPasswords[user.username] && (
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => navigator.clipboard.writeText(temporaryPasswords[user.username])}
                  >
                    Copy
                  </button>
                )}
              </div>
              <div className="user-row-actions">
                <button type="button" className="secondary-button" onClick={() => saveUser(user.username)}>
                  <Save size={15} />
                  Save
                </button>
                <button
                  type="button"
                  title="Delete user"
                  className="icon-button"
                  disabled={user.username === "admin"}
                  onClick={() => removeUser(user.username)}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );

  function updateDraft(username: string, patch: Partial<UserSummary>) {
    setDrafts((current) => ({ ...current, [username]: { ...(current[username] ?? users.find((user) => user.username === username)!), ...patch } }));
  }

  function updatePrivileges(username: string, serviceLine: string, privilege: ServicePrivilege) {
    const draft = drafts[username] ?? users.find((user) => user.username === username);
    if (!draft) return;
    updateDraft(username, {
      servicePrivileges: {
        ...draft.servicePrivileges,
        [serviceLine]: privilege
      }
    });
  }

  function setAllPrivileges(username: string, privilege: ServicePrivilege) {
    updateDraft(username, { servicePrivileges: buildPrivileges(serviceLines, privilege) });
  }
}

function buildPrivileges(serviceLines: string[], privilege: ServicePrivilege): ServicePrivileges {
  return Object.fromEntries(serviceLines.map((serviceLine) => [serviceLine, privilege]));
}

function normalizePrivilegesForServices(privileges: ServicePrivileges, serviceLines: string[]): ServicePrivileges {
  return {
    ...buildPrivileges(serviceLines, "view"),
    ...Object.fromEntries(
      Object.entries(privileges)
        .filter(([serviceLine]) => serviceLines.includes(serviceLine))
        .map(([serviceLine, privilege]) => [serviceLine, privilege === "edit" || privilege === "request" ? privilege : "view"])
    )
  };
}

function parseUserEntries(entries: string): Array<{ username: string; displayName?: string }> {
  return entries
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [username, ...displayNameParts] = line.split(/[,|]/).map((part) => part.trim());
      return {
        username: username ?? "",
        displayName: displayNameParts.join(" ").trim() || undefined
      };
    });
}

export function PasswordChangeRequiredScreen({
  token,
  username,
  onPasswordChanged,
  onSkip,
  onLogout
}: {
  token: string;
  username: string;
  onPasswordChanged: (user: PasswordChangeResponse) => void;
  onSkip: () => Promise<void>;
  onLogout: () => void;
}) {
  const [isSkipping, setIsSkipping] = useState(false);
  const [skipError, setSkipError] = useState<string | undefined>();

  async function skipForNow() {
    try {
      setIsSkipping(true);
      setSkipError(undefined);
      await onSkip();
    } catch (error) {
      setSkipError(error instanceof Error ? error.message : "Unable to skip password change");
      setIsSkipping(false);
    }
  }

  return (
    <main className="login-screen password-change-required-screen">
      <button className="secondary-button temporary-password-logout" type="button" onClick={onLogout}>
        <LogOut size={16} />
        Log out
      </button>
      <div className="password-change-required-panel">
        <PasswordChangeForm
          token={token}
          username={username}
          heading="Change Password"
          copy="Use your temporary or current password, then choose a new one. Or skip for now to continue to the planner."
          onPasswordChanged={onPasswordChanged}
        />
        <p className="muted-copy temporary-password-reminder">
          You will see this screen again each time you sign in until you change your password.
        </p>
        {skipError && <p className="error-text">{skipError}</p>}
        <button className="secondary-button temporary-password-skip" type="button" onClick={skipForNow} disabled={isSkipping}>
          Skip for now
        </button>
      </div>
    </main>
  );
}

export function AccountTab({
  token,
  username,
  onToast,
  onPasswordChanged,
  onOpenTamagotchi,
  eggLink,
  children
}: {
  token: string;
  username: string;
  onToast: (message: string) => void;
  onPasswordChanged?: (user: PasswordChangeResponse) => void;
  onOpenTamagotchi?: () => void;
  eggLink?: string;
  children?: ReactNode;
}) {
  return (
    <section className="account-panel">
      {(onOpenTamagotchi || eggLink) && (
        <div className="account-easter-egg-row">
          {eggLink ? (
            <a
              className="icon-button account-easter-egg-button"
              href={eggLink}
              title="Open Surgemon"
              aria-label="Open Surgemon"
            >
              🥚
            </a>
          ) : (
            <button
              type="button"
              className="icon-button account-easter-egg-button"
              title="Dr. Nussbaum"
              aria-label="Open Dr. Nussbaum"
              onClick={onOpenTamagotchi}
            >
              🥚
            </button>
          )}
        </div>
      )}
      {children}
      <PasswordChangeForm
        token={token}
        username={username}
        heading={username}
        onPasswordChanged={(user) => {
          onPasswordChanged?.(user);
          onToast("Password changed");
        }}
      />
    </section>
  );
}

function PasswordChangeForm({
  token,
  username,
  heading,
  copy,
  onPasswordChanged
}: {
  token: string;
  username: string;
  heading: string;
  copy?: string;
  onPasswordChanged: (user: PasswordChangeResponse) => void;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      setError(undefined);
      const user = await changeMyPassword(token, currentPassword, nextPassword);
      setCurrentPassword("");
      setNextPassword("");
      onPasswordChanged(user);
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : "Password change failed");
    }
  }

  return (
    <form className="editor-panel" onSubmit={submit}>
      <p className="eyebrow">Account</p>
      <h2>{heading}</h2>
      {copy && <p className="muted-copy">{copy}</p>}
      <p className="muted-copy">{username}</p>
      <label>
        Current or temporary password
        <input value={currentPassword} type="password" onChange={(event) => setCurrentPassword(event.target.value)} />
      </label>
      <label>
        New password
        <input value={nextPassword} type="password" onChange={(event) => setNextPassword(event.target.value)} />
      </label>
      {error && <p className="error-text">{error}</p>}
      <button className="primary-button" type="submit" disabled={!currentPassword || !nextPassword}>
        <Users size={16} />
        Change Password
      </button>
    </form>
  );
}
