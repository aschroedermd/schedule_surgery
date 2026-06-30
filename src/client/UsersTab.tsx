import { FormEvent, useEffect, useState } from "react";
import { KeyRound, Plus, Save, Trash2, Users } from "lucide-react";
import {
  changeMyPassword,
  createUser,
  deleteUser,
  fetchUsers,
  resetUserPassword,
  updateUser,
  updateUsersPin
} from "./api";
import { Role, ServicePrivilege, ServicePrivileges, UserSummary } from "../shared/types";

export function UsersTab({
  token,
  serviceLines,
  onToast
}: {
  token: string;
  serviceLines: string[];
  onToast: (message: string) => void;
}) {
  const [pin, setPin] = useState("");
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, UserSummary>>({});
  const [temporaryPasswords, setTemporaryPasswords] = useState<Record<string, string>>({});
  const [newPin, setNewPin] = useState("");
  const [addDraft, setAddDraft] = useState({ username: "", displayName: "", password: "schroeder1" });
  const [error, setError] = useState<string | undefined>();
  const unlocked = users.length > 0;

  useEffect(() => {
    setDrafts(Object.fromEntries(users.map((user) => [user.username, user])));
  }, [users]);

  async function unlock(event: FormEvent) {
    event.preventDefault();
    await runUsersAction(async () => {
      setUsers(await fetchUsers(token, pin));
    });
  }

  async function addUser(event: FormEvent) {
    event.preventDefault();
    await runUsersAction(async () => {
      setUsers(await createUser(token, pin, addDraft));
      setAddDraft({ username: "", displayName: "", password: "schroeder1" });
      onToast("User added");
    });
  }

  async function saveUser(username: string) {
    const draft = drafts[username];
    if (!draft) return;
    await runUsersAction(async () => {
      setUsers(
        await updateUser(token, pin, username, {
          displayName: draft.displayName,
          role: draft.role,
          servicePrivileges: draft.servicePrivileges
        })
      );
      onToast("User saved");
    });
  }

  async function resetPassword(username: string) {
    await runUsersAction(async () => {
      const result = await resetUserPassword(token, pin, username);
      setUsers(result.users);
      setTemporaryPasswords((current) => ({ ...current, [username]: result.temporaryPassword }));
      onToast("Temporary password generated");
    });
  }

  async function removeUser(username: string) {
    if (!window.confirm(`Delete ${username}?`)) return;
    await runUsersAction(async () => {
      setUsers(await deleteUser(token, pin, username));
      onToast("User deleted");
    });
  }

  async function changePin(event: FormEvent) {
    event.preventDefault();
    await runUsersAction(async () => {
      await updateUsersPin(token, pin, newPin);
      setPin(newPin);
      setNewPin("");
      onToast("Users pin updated");
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

  if (!unlocked) {
    return (
      <section className="users-panel pin-panel">
        <form className="editor-panel" onSubmit={unlock}>
          <h2>Users</h2>
          <p className="muted-copy">Enter the users pin code.</p>
          <label>
            Pin code
            <input value={pin} type="password" inputMode="numeric" onChange={(event) => setPin(event.target.value)} autoFocus />
          </label>
          {error && <p className="error-text">{error}</p>}
          <button className="primary-button" type="submit">
            <KeyRound size={16} />
            Unlock
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="users-panel">
      <div className="users-header">
        <div>
          <p className="eyebrow">Access</p>
          <h2>Users</h2>
        </div>
        <form className="inline-form" onSubmit={changePin}>
          <input
            aria-label="New users pin"
            value={newPin}
            type="password"
            inputMode="numeric"
            placeholder="New pin"
            onChange={(event) => setNewPin(event.target.value)}
          />
          <button className="secondary-button" type="submit" disabled={!newPin}>
            <KeyRound size={15} />
            Change Pin
          </button>
        </form>
      </div>

      {error && <div className="alert danger">{error}</div>}

      <form className="user-add-form" onSubmit={addUser}>
        <input
          aria-label="New username"
          value={addDraft.username}
          placeholder="username"
          onChange={(event) => setAddDraft({ ...addDraft, username: event.target.value })}
        />
        <input
          aria-label="New display name"
          value={addDraft.displayName}
          placeholder="display name"
          onChange={(event) => setAddDraft({ ...addDraft, displayName: event.target.value })}
        />
        <input
          aria-label="New user password"
          value={addDraft.password}
          type="password"
          placeholder="password"
          onChange={(event) => setAddDraft({ ...addDraft, password: event.target.value })}
        />
        <button className="primary-button" type="submit">
          <Plus size={16} />
          Add User
        </button>
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
              <select
                aria-label={`${user.username} role`}
                value={draft.role}
                disabled={user.username === "admin"}
                onChange={(event) => updateDraft(user.username, { role: event.target.value as Role })}
              >
                <option value="viewer">user</option>
                <option value="admin">admin</option>
              </select>
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
}

export function PasswordChangeRequiredScreen({
  token,
  username,
  onPasswordChanged
}: {
  token: string;
  username: string;
  onPasswordChanged: (user: UserSummary) => void;
}) {
  return (
    <main className="login-screen">
      <PasswordChangeForm
        token={token}
        username={username}
        heading="Change Password"
        copy="Use your temporary or current password, then choose a new one."
        onPasswordChanged={onPasswordChanged}
      />
    </main>
  );
}

export function AccountTab({
  token,
  username,
  onToast,
  onPasswordChanged
}: {
  token: string;
  username: string;
  onToast: (message: string) => void;
  onPasswordChanged?: (user: UserSummary) => void;
}) {
  return (
    <section className="account-panel">
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
  onPasswordChanged: (user: UserSummary) => void;
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
