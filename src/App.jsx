import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged, signInWithCustomToken } from 'firebase/auth';
import { 
    getFirestore, 
    collection, 
    doc, 
    addDoc, 
    setDoc, 
    getDoc, 
    onSnapshot, 
    writeBatch
} from 'firebase/firestore';
import { Calendar, Plus, Trash2, Edit, X, Cake, PartyPopper, Banknote, Users, CheckSquare, Square, AlertTriangle } from 'lucide-react';

// --- Firebase Configuration (from Netlify env) ---
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "your-api-key",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "your-auth-domain",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "your-project-id",
};

// --- Firebase Initialization ---
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// --- App ID ---
const appId = process.env.REACT_APP_APP_ID || 'default-cake-fund-app';

// --- Helper Functions ---
const formatDate = (date) => {
    if (!date) return '';
    const d = date instanceof Date ? date : date.toDate();
    return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(d);
};

const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
};


// --- Main App Component ---
export default function App() {
    // --- State Management ---
    const [user, setUser] = useState(null);
    const [isOrganizer, setIsOrganizer] = useState(false);
    const [coworkers, setCoworkers] = useState([]);
    const [contributions, setContributions] = useState({});
    const [loading, setLoading] = useState(true);
    
    const [isCoworkerModalOpen, setIsCoworkerModalOpen] = useState(false);
    const [isAddContributorModalOpen, setIsAddContributorModalOpen] = useState(false);
    const [editingCoworker, setEditingCoworker] = useState(null);

    const [isPaymentInfoModalOpen, setIsPaymentInfoModalOpen] = useState(false);
    const [paymentInfo, setPaymentInfo] = useState({ method: '', details: '' });

    const [isContributionModalOpen, setIsContributionModalOpen] = useState(false);
    const [contributionTarget, setContributionTarget] = useState(null);

    // --- Authentication Effect ---
    useEffect(() => {
        const initialAuthToken = process.env.REACT_APP_AUTH_TOKEN || null;

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            if (currentUser) {
                setUser(currentUser);
            }
        });

        const signIn = async () => {
            if (auth.currentUser) {
                setUser(auth.currentUser);
                return;
            }
            try {
                if (initialAuthToken) {
                    await signInWithCustomToken(auth, initialAuthToken);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Authentication failed:", error);
            }
        };
        
        signIn();

        return () => unsubscribe();
    }, []);

    // --- Organizer Check and Data Fetching Effect ---
    useEffect(() => {
        if (!user) return;

        const publicPath = `artifacts/${appId}/public/data`;
        const adminRef = doc(db, publicPath, 'meta', 'admin');

        const checkOrganizer = async () => {
            try {
                const docSnap = await getDoc(adminRef);
                if (docSnap.exists()) {
                    if (docSnap.data().organizerUid === user.uid) {
                        setIsOrganizer(true);
                    }
                } else {
                    // First user becomes the organizer
                    await setDoc(adminRef, { organizerUid: user.uid });
                    setIsOrganizer(true);
                }
            } catch (error) {
                console.error("Error checking or setting organizer:", error);
            } finally {
                setLoading(false);
            }
        };

        checkOrganizer();

        // Fetch Coworkers
        const coworkersCol = collection(db, publicPath, 'coworkers');
        const unsubscribeCoworkers = onSnapshot(coworkersCol, (snapshot) => {
            const coworkersData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            coworkersData.forEach(cw => {
                if (cw.birthday && cw.birthday.toDate) {
                    cw.birthday = cw.birthday.toDate();
                }
            });
            setCoworkers(coworkersData);
        }, (error) => {
            console.error("Coworker listener error:", error);
        });

        // Fetch Contributions
        const contributionsCol = collection(db, publicPath, 'contributions');
        const unsubscribeContributions = onSnapshot(contributionsCol, (snapshot) => {
            const contributionsData = {};
            snapshot.docs.forEach(doc => {
                contributionsData[doc.id] = { id: doc.id, ...doc.data() };
            });
            setContributions(contributionsData);
        }, (error) => {
            console.error("Contributions listener error:", error);
        });
        
        // Fetch Payment Info
        const paymentInfoDocRef = doc(db, publicPath, 'paymentInfo', 'details');
        const unsubscribePaymentInfo = onSnapshot(paymentInfoDocRef, (doc) => {
            if (doc.exists()) {
                setPaymentInfo(doc.data());
            } else {
                setPaymentInfo({ method: '', details: '' });
            }
        }, (error) => {
            console.error("Payment info listener error:", error);
        });

        return () => {
            unsubscribeCoworkers();
            unsubscribeContributions();
            unsubscribePaymentInfo();
        };
    }, [user]);

    // --- Memoized Calculations for Upcoming Birthdays ---
    const upcomingBirthdays = useMemo(() => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const next30Days = new Date(today);
        next30Days.setDate(today.getDate() + 30);

        return coworkers
            .map(cw => {
                if (!cw.birthday) return null;
                const birthday = new Date(cw.birthday);
                birthday.setFullYear(today.getFullYear());
                if (birthday < today) {
                    birthday.setFullYear(today.getFullYear() + 1);
                }
                return { ...cw, nextBirthday: birthday };
            })
            .filter(Boolean)
            .filter(cw => cw.nextBirthday >= today && cw.nextBirthday <= next30Days)
            .sort((a, b) => a.nextBirthday - b.nextBirthday);
    }, [coworkers]);

    // (rest of your component code remains unchanged)
}
