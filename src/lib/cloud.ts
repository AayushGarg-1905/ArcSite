import type { CadEntity, Scene } from '../types';
import type { ProjectBackend, ProjectData, ProjectMeta } from './projects';
import { DEFAULT_SCENES } from './projects';

/** True when Firebase web-config env vars are present (see .env.example). */
export const CLOUD_READY =
  Boolean(import.meta.env.VITE_FIREBASE_API_KEY) &&
  Boolean(import.meta.env.VITE_FIREBASE_PROJECT_ID);

type Deps = {
  app: import('firebase/app').FirebaseApp;
  auth: import('firebase/auth').Auth;
  db: import('firebase/firestore').Firestore;
  fs: typeof import('firebase/firestore');
};

let deps: Deps | null = null;

async function ensure(): Promise<Deps> {
  if (deps) return deps;
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getAuth } = await import('firebase/auth');
  const { initializeFirestore, persistentLocalCache } = await import('firebase/firestore');
  const fs = await import('firebase/firestore');
  const config = {
    apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string,
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as string,
    appId: import.meta.env.VITE_FIREBASE_APP_ID as string,
  };
  const app = getApps().length ? getApp() : initializeApp(config);
  const auth = getAuth(app);
  // persistent cache => offline editing, syncs when back online
  let db: import('firebase/firestore').Firestore;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache() });
  } catch {
    const { getFirestore } = fs;
    db = getFirestore(app);
  }
  deps = { app, auth, db, fs };
  return deps;
}

/** Cloud storage: one `arcsite/{uid}/projects/{projectId}` doc per project. */
export class CloudBackend implements ProjectBackend {
  readonly kind = 'cloud' as const;
  private uid: string;
  constructor(uid: string) {
    this.uid = uid;
  }

  private async col() {
    const { db, fs } = await ensure();
    return fs.collection(db, 'arcsite', this.uid, 'projects');
  }

  async list(): Promise<ProjectMeta[]> {
    const { fs } = await ensure();
    const col = await this.col();
    const snap = await fs.getDocs(fs.query(col, fs.orderBy('updatedAt', 'desc')));
    return snap.docs.map((d) => {
      const v = d.data() as Record<string, unknown>;
      return {
        id: d.id,
        name: String(v.name ?? 'Untitled'),
        createdAt: Number(v.createdAt ?? 0),
        updatedAt: Number(v.updatedAt ?? 0),
        entityCount: Number(v.entityCount ?? 0),
        thumbnail: typeof v.thumbnail === 'string' ? v.thumbnail : undefined,
      } as ProjectMeta;
    });
  }

  async load(id: string): Promise<ProjectData | null> {
    const { db, fs } = await ensure();
    const snap = await fs.getDoc(fs.doc(db, 'arcsite', this.uid, 'projects', id));
    if (!snap.exists()) return null;
    const data = snap.data() as { entities?: unknown; scenes?: unknown };
    const entities = Array.isArray(data.entities) ? (data.entities as CadEntity[]) : [];
    const scenes = Array.isArray(data.scenes) && data.scenes.length ? (data.scenes as Scene[]) : DEFAULT_SCENES;
    return { entities, scenes };
  }

  async save(meta: ProjectMeta, entities: CadEntity[], scenes: Scene[]): Promise<void> {
    const { db, fs } = await ensure();
    await fs.setDoc(fs.doc(db, 'arcsite', this.uid, 'projects', meta.id), { ...meta, entities, scenes });
  }

  async remove(id: string): Promise<void> {
    const { db, fs } = await ensure();
    await fs.deleteDoc(fs.doc(db, 'arcsite', this.uid, 'projects', id));
  }
}

export async function signInWithGoogle(): Promise<string> {
  const { auth } = await ensure();
  const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
  const cred = await signInWithPopup(auth, new GoogleAuthProvider());
  return cred.user.email ?? cred.user.uid;
}

export async function signOutCloud(): Promise<void> {
  const { auth } = await ensure();
  const { signOut } = await import('firebase/auth');
  await signOut(auth);
}

export function watchAuth(cb: (uid: string | null, email: string | null) => void): () => void {
  let off: (() => void) | null = null;
  let cancelled = false;
  (async () => {
    const { auth } = await ensure();
    if (cancelled) return;
    const { onAuthStateChanged } = await import('firebase/auth');
    off = onAuthStateChanged(auth, (u) => cb(u ? u.uid : null, u ? u.email : null));
  })();
  return () => {
    cancelled = true;
    off?.();
  };
}
