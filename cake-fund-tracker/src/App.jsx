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
    deleteDoc, 
    onSnapshot, 
    query, 
    writeBatch
} from 'firebase/firestore';
import { Calendar, User, Plus, Trash2, Edit, X, Cake, PartyPopper, Banknote, Users, CheckSquare, Square, AlertTriangle } from 'lucide-react';

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
    // Changed currency to PHP
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
        const initialAuthToken = initialAuthToken; // uses env var above, or null

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

    // --- CRUD Operations ---
    const handleSaveCoworker = async (coworkerData) => {
        if (!user || !isOrganizer) return;
        const { id, name, birthday } = coworkerData;
        const data = { name, birthday: birthday ? new Date(birthday) : null };
        const coworkersCol = collection(db, `artifacts/${appId}/public/data`, 'coworkers');

        try {
            if (id) {
                await setDoc(doc(coworkersCol, id), data);
            } else {
                await addDoc(coworkersCol, data);
            }
            setIsCoworkerModalOpen(false);
            setEditingCoworker(null);
        } catch (error) {
            console.error("Error saving coworker: ", error);
        }
    };
    
    const handleSaveContributorName = async (name) => {
        if (!user || !name) return;
        const data = { name, birthday: null };
        const coworkersCol = collection(db, `artifacts/${appId}/public/data`, 'coworkers');
        try {
            await addDoc(coworkersCol, data);
            setIsAddContributorModalOpen(false);
        } catch (error) {
            console.error("Error saving contributor:", error);
        }
    };

    const handleDeleteCoworker = async (coworkerId) => {
        if (!isOrganizer) return;
        if (true) { 
            try {
                const batch = writeBatch(db);
                const publicPath = `artifacts/${appId}/public/data`;
                
                const coworkerRef = doc(db, publicPath, 'coworkers', coworkerId);
                batch.delete(coworkerRef);

                Object.values(contributions).forEach(contribution => {
                    if (contribution.contributors && contribution.contributors[coworkerId] !== undefined) {
                        const contributionRef = doc(db, publicPath, 'contributions', contribution.id);
                        const updatedContributors = { ...contribution.contributors };
                        delete updatedContributors[coworkerId];
                        batch.update(contributionRef, { contributors: updatedContributors });
                    }
                });

                await batch.commit();
            } catch (error) {
                console.error("Error deleting coworker: ", error);
            }
        }
    };
    
    const handleSavePaymentInfo = async (newPaymentInfo) => {
        if (!user || !isOrganizer) return;
        try {
            const paymentInfoDocRef = doc(db, `artifacts/${appId}/public/data`, 'paymentInfo', 'details');
            await setDoc(paymentInfoDocRef, newPaymentInfo);
            setIsPaymentInfoModalOpen(false);
        } catch (error) {
            console.error("Error saving payment info:", error);
        }
    };

    // --- Contribution Handling ---
    const updateContribution = async (birthdayCoworkerId, contributorId, newContributionData) => {
        if (!user) return;
        const contributionId = `${birthdayCoworkerId}_${new Date().getFullYear()}`;
        const contributionRef = doc(db, `artifacts/${appId}/public/data`, 'contributions', contributionId);

        let currentContributors = {};
        if (contributions[contributionId]) {
            currentContributors = contributions[contributionId].contributors || {};
        } else {
            coworkers.forEach(cw => {
                currentContributors[cw.id] = { amount: 0, status: 'unpaid' };
            });
        }
        
        const updatedContributors = { ...currentContributors, [contributorId]: newContributionData };

        try {
            await setDoc(contributionRef, {
                birthdayCoworkerId,
                year: new Date().getFullYear(),
                contributors: updatedContributors
            }, { merge: true });
        } catch (error) {
            console.error("Error updating contribution: ", error);
        }
    };

    const handlePledgeContribution = (amount) => {
        if (contributionTarget) {
            const { birthdayCoworkerId, contributorId } = contributionTarget;
            updateContribution(birthdayCoworkerId, contributorId, { amount, status: 'pledged' });
        }
        setIsContributionModalOpen(false);
        setContributionTarget(null);
    };
    
    const handleContributionClick = (birthdayCoworkerId, contributorId, contribution) => {
        const currentStatus = contribution?.status || 'unpaid';
        const currentAmount = contribution?.amount || 0;

        if (currentStatus === 'unpaid') {
            setContributionTarget({ birthdayCoworkerId, contributorId });
            setIsContributionModalOpen(true);
        } else if (currentStatus === 'pledged') {
            updateContribution(birthdayCoworkerId, contributorId, { amount: currentAmount, status: 'paid' });
        } else if (currentStatus === 'paid') {
             updateContribution(birthdayCoworkerId, contributorId, { amount: 0, status: 'unpaid' });
        }
    };


    // --- Render Logic ---
    if (loading) {
        return <div className="flex items-center justify-center min-h-screen bg-slate-50"><div className="text-xl font-semibold text-slate-600">Loading Tracker...</div></div>;
    }

    return (
        <div className="min-h-screen bg-slate-100 font-sans text-slate-800 p-4 sm:p-6 lg:p-8">
            <div className="max-w-7xl mx-auto">
                {/* Header */}
                <header className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8">
                    <div className="flex items-center gap-3 mb-4 sm:mb-0">
                        <PartyPopper className="h-10 w-10 text-pink-500" />
                        <div>
                            <h1 className="text-3xl font-bold text-slate-900">CakeFund Tracker</h1>
                            <p className="text-slate-500">Coordinate birthday collections with ease.</p>
                        </div>
                    </div>
                    {isOrganizer ? (
                        <button
                            onClick={() => { setEditingCoworker(null); setIsCoworkerModalOpen(true); }}
                            className="flex items-center gap-2 bg-pink-500 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-pink-600 transition-all duration-200"
                        >
                            <Plus size={20} />
                            Add Coworker
                        </button>
                    ) : (
                         <button
                            onClick={() => setIsAddContributorModalOpen(true)}
                            className="flex items-center gap-2 bg-green-500 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-green-600 transition-all duration-200"
                        >
                            <Plus size={20} />
                            Add My Name
                        </button>
                    )}
                </header>

                <main className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                    {/* Left Column: Upcoming Birthdays */}
                    <div className="lg:col-span-2 space-y-8">
                        <section>
                            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-3"><Cake className="text-pink-500" />Upcoming Birthdays</h2>
                            {upcomingBirthdays.length > 0 ? (
                                <div className="space-y-4">
                                    {upcomingBirthdays.map(bdayCoworker => {
                                        const contributionId = `${bdayCoworker.id}_${new Date().getFullYear()}`;
                                        const contributionData = contributions[contributionId]?.contributors || {};
                                        const paidContributions = Object.values(contributionData).filter(c => c.status === 'paid');
                                        const paidCount = paidContributions.length;
                                        const totalAmount = paidContributions.reduce((sum, c) => sum + c.amount, 0);
                                        const totalContributors = coworkers.length > 1 ? coworkers.length - 1 : 0;
                                        const progress = totalContributors > 0 ? (paidCount / totalContributors) * 100 : 0;

                                        return (
                                            <BirthdayCard 
                                                key={bdayCoworker.id}
                                                bdayCoworker={bdayCoworker}
                                                coworkers={coworkers}
                                                contributionData={contributionData}
                                                progress={progress}
                                                paidCount={paidCount}
                                                totalCount={totalContributors}
                                                totalAmount={totalAmount}
                                                paymentInfo={paymentInfo}
                                                onContributionClick={handleContributionClick}
                                            />
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="bg-white p-6 rounded-lg shadow-sm text-center text-slate-500">
                                    <p>No birthdays in the next 30 days.</p>
                                    <p className="text-sm mt-1">Organizer can add coworkers with birthdays to see them here.</p>
                                </div>
                            )}
                        </section>
                    </div>

                    {/* Right Column: Coworker List & Payment Info */}
                    <aside className="space-y-8">
                        <section className="bg-white p-4 rounded-lg shadow-sm">
                            <h2 className="text-2xl font-semibold mb-4 flex items-center gap-3"><Users className="text-pink-500"/>All Coworkers</h2>
                            <div className="max-h-96 overflow-y-auto pr-2">
                                <ul className="divide-y divide-slate-200">
                                    {coworkers.sort((a,b) => a.name.localeCompare(b.name)).map(cw => (
                                        <li key={cw.id} className="flex justify-between items-center py-3">
                                            <div>
                                                <p className="font-semibold">{cw.name}</p>
                                                {cw.birthday && (
                                                    <p className="text-sm text-slate-500 flex items-center gap-1.5">
                                                        <Calendar size={14}/>
                                                        {formatDate(cw.birthday)}
                                                    </p>
                                                )}
                                            </div>
                                            {isOrganizer && (
                                                <div className="flex items-center gap-2">
                                                    <button onClick={() => { setEditingCoworker(cw); setIsCoworkerModalOpen(true); }} className="text-slate-500 hover:text-blue-500"><Edit size={18}/></button>
                                                    <button onClick={() => handleDeleteCoworker(cw.id)} className="text-slate-500 hover:text-red-500"><Trash2 size={18}/></button>
                                                </div>
                                            )}
                                        </li>
                                    ))}
                                    {coworkers.length === 0 && <p className="text-center text-slate-400 py-4">No coworkers added yet.</p>}
                                </ul>
                            </div>
                        </section>
                        <section>
                             <h2 className="text-2xl font-semibold mb-4 flex items-center gap-3"><Banknote className="text-pink-500"/>Payment Info</h2>
                             <div className="bg-white p-4 rounded-lg shadow-sm">
                                {paymentInfo && paymentInfo.details ? (
                                    <div className="text-slate-600 whitespace-pre-wrap min-h-[50px]">
                                        <span className="font-semibold">{paymentInfo.method}: </span>
                                        <span>{paymentInfo.details}</span>
                                    </div>
                                 ) : (
                                    <p className="text-slate-500 min-h-[50px] flex items-center">No payment info set.</p>
                                 )}
                                 {isOrganizer && (
                                    <button onClick={() => setIsPaymentInfoModalOpen(true)} className="text-sm text-pink-500 font-semibold mt-2 hover:underline">
                                        Edit Payment Info
                                    </button>
                                 )}
                             </div>
                        </section>
                    </aside>
                </main>
            </div>

            {/* Modals */}
            {isOrganizer && isCoworkerModalOpen && (
                <CoworkerModal
                    coworker={editingCoworker}
                    onSave={handleSaveCoworker}
                    onClose={() => { setIsCoworkerModalOpen(false); setEditingCoworker(null); }}
                />
            )}
            {isAddContributorModalOpen && (
                 <AddContributorModal
                    onSave={handleSaveContributorName}
                    onClose={() => setIsAddContributorModalOpen(false)}
                />
            )}
            {isOrganizer && isPaymentInfoModalOpen && (
                <PaymentInfoModal
                    initialInfo={paymentInfo}
                    onSave={handleSavePaymentInfo}
                    onClose={() => setIsPaymentInfoModalOpen(false)}
                />
            )}
            {isContributionModalOpen && contributionTarget && (
                <ContributionModal
                    onSave={handlePledgeContribution}
                    onClose={() => setIsContributionModalOpen(false)}
                />
            )}
        </div>
    );
}

// --- Sub-Components ---

function BirthdayCard({ bdayCoworker, coworkers, contributionData, progress, paidCount, totalCount, totalAmount, paymentInfo, onContributionClick }) {
    return (
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="p-6">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center">
                    <div>
                        <p className="text-sm font-semibold text-pink-500">{formatDate(bdayCoworker.nextBirthday)}</p>
                        <h3 className="text-2xl font-bold">{bdayCoworker.name}'s Birthday!</h3>
                    </div>
                    <div className="mt-2 sm:mt-0 text-right">
                        <p className="font-bold text-xl text-pink-600">{formatCurrency(totalAmount)}</p>
                        <p className="text-sm text-slate-500">{paidCount} / {totalCount} contributions paid</p>
                    </div>
                </div>
                <div className="mt-4">
                    <div className="w-full bg-slate-200 rounded-full h-2.5">
                        <div className="bg-pink-500 h-2.5 rounded-full" style={{ width: `${progress}%` }}></div>
                    </div>
                </div>
                {paymentInfo && paymentInfo.details && (
                    <div className="mt-4 p-3 bg-slate-50 rounded-md border border-slate-200">
                        <p className="text-sm font-semibold text-slate-700">Payment Details:</p>
                        <p className="text-sm text-slate-600 whitespace-pre-wrap">
                            <span className="font-semibold">{paymentInfo.method}: </span>
                            {paymentInfo.details}
                        </p>
                    </div>
                )}
            </div>
            <div className="bg-slate-50 p-6">
                <h4 className="font-semibold mb-3">Contribution Status:</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {coworkers
                        .filter(cw => cw.id !== bdayCoworker.id)
                        .sort((a,b) => a.name.localeCompare(b.name))
                        .map(cw => {
                            const contribution = contributionData[cw.id] || { amount: 0, status: 'unpaid' };
                            const { amount, status } = contribution;
                            
                            const statusStyles = {
                                unpaid: 'bg-slate-100 hover:bg-slate-200',
                                pledged: 'bg-yellow-100 hover:bg-yellow-200',
                                paid: 'bg-green-100 hover:bg-green-200',
                            };
                             const textStyles = {
                                unpaid: 'text-slate-600',
                                pledged: 'font-semibold text-yellow-800',
                                paid: 'font-semibold text-green-800',
                            };
                            const icon = {
                                unpaid: <Square size={18} className="text-slate-400"/>,
                                pledged: <AlertTriangle size={18} className="text-yellow-500"/>,
                                paid: <CheckSquare size={18} className="text-green-600"/>,
                            };

                            return (
                                <div key={cw.id} onClick={() => onContributionClick(bdayCoworker.id, cw.id, contribution)} 
                                    className={`flex justify-between items-center p-2 rounded-md cursor-pointer transition-colors ${statusStyles[status]}`}>
                                    <div className="flex items-center gap-2">
                                        {icon[status]}
                                        <span className={`text-sm ${textStyles[status]}`}>{cw.name}</span>
                                    </div>
                                    {amount > 0 && <span className={`text-sm font-bold ${textStyles[status]}`}>{formatCurrency(amount)}</span>}
                                </div>
                            );
                        })}
                </div>
            </div>
        </div>
    );
}

function CoworkerModal({ coworker, onSave, onClose }) {
    const [coworkerType, setCoworkerType] = useState(coworker?.birthday ? 'birthday' : 'contributor');
    const [name, setName] = useState(coworker?.name || '');
    const [birthday, setBirthday] = useState(coworker?.birthday ? new Date(coworker.birthday).toISOString().split('T')[0] : '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name || (coworkerType === 'birthday' && !birthday)) {
            alert("Please fill in all required fields.");
            return;
        }
        onSave({
            id: coworker?.id,
            name,
            birthday: coworkerType === 'birthday' ? birthday : (birthday || null),
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold">{coworker ? 'Edit Coworker' : 'Add New Coworker'}</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X size={24}/></button>
                </div>
                <form onSubmit={handleSubmit}>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-700">Coworker Type</label>
                            <div className="mt-2 flex gap-6">
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" value="birthday" checked={coworkerType === 'birthday'} onChange={() => setCoworkerType('birthday')} className="h-4 w-4 text-pink-600 border-gray-300 focus:ring-pink-500" />
                                    <span className="ml-2 text-sm text-slate-700">Birthday Person</span>
                                </label>
                                <label className="flex items-center cursor-pointer">
                                    <input type="radio" value="contributor" checked={coworkerType === 'contributor'} onChange={() => setCoworkerType('contributor')} className="h-4 w-4 text-pink-600 border-gray-300 focus:ring-pink-500" />
                                    <span className="ml-2 text-sm text-slate-700">Contributor Only</span>
                                </label>
                            </div>
                        </div>

                        <div>
                            <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full Name</label>
                            <input type="text" id="name" value={name} onChange={e => setName(e.target.value)} required className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500" />
                        </div>
                        
                        <div>
                            <label htmlFor="birthday" className="block text-sm font-medium text-slate-700">
                                Birthday {coworkerType === 'contributor' && <span className="text-xs text-slate-500">(Optional)</span>}
                            </label>
                            <input 
                                type="date" 
                                id="birthday" 
                                value={birthday} 
                                onChange={e => setBirthday(e.target.value)} 
                                required={coworkerType === 'birthday'} 
                                className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500" 
                            />
                        </div>

                    </div>
                    <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                        <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-pink-500 text-base font-medium text-white hover:bg-pink-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm">Save</button>
                        <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:w-auto sm:text-sm">Cancel</button>
                    </div>
                </form>
            </div>
        </div>
    );
}

function AddContributorModal({ onSave, onClose }) {
    const [name, setName] = useState('');

    const handleSave = () => {
        if (name.trim()) {
            onSave(name.trim());
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold">Add Your Name</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X size={24}/></button>
                </div>
                <div className="p-6">
                    <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full Name</label>
                    <input
                        type="text"
                        id="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500"
                        placeholder="e.g., Juan Dela Cruz"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                </div>
                <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                    <button onClick={handleSave} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-green-500 text-base font-medium text-white hover:bg-green-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm">Add Name</button>
                    <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:w-auto sm:text-sm">Cancel</button>
                </div>
            </div>
        </div>
    );
}


function PaymentInfoModal({ initialInfo, onSave, onClose }) {
    const [method, setMethod] = useState(initialInfo?.method || '');
    const [details, setDetails] = useState(initialInfo?.details || '');

    const handleSave = () => {
        onSave({ method, details });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-md">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold">Edit Payment Information</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X size={24}/></button>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label htmlFor="paymentMethod" className="block text-sm font-medium text-slate-700">Payment Method</label>
                        <input
                            type="text"
                            id="paymentMethod"
                            value={method}
                            onChange={(e) => setMethod(e.target.value)}
                            className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500"
                            placeholder="e.g., GCash, BPI"
                        />
                    </div>
                    <div>
                        <label htmlFor="paymentDetails" className="block text-sm font-medium text-slate-700">Payment Details</label>
                        <textarea
                            id="paymentDetails"
                            value={details}
                            onChange={(e) => setDetails(e.target.value)}
                            rows="3"
                            className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500"
                            placeholder="e.g., Juan Dela Cruz - 09171234567"
                        ></textarea>
                    </div>
                </div>
                <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                    <button onClick={handleSave} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-pink-500 text-base font-medium text-white hover:bg-pink-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm">Save</button>
                    <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:w-auto sm:text-sm">Cancel</button>
                </div>
            </div>
        </div>
    );
}

function ContributionModal({ onSave, onClose }) {
    const [amount, setAmount] = useState('');

    const handleSave = () => {
        const parsedAmount = parseFloat(amount);
        if (!isNaN(parsedAmount) && parsedAmount > 0) {
            onSave(parsedAmount);
        } else {
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm">
                <div className="flex justify-between items-center p-4 border-b">
                    <h2 className="text-xl font-semibold">Enter Contribution Amount</h2>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-800"><X size={24}/></button>
                </div>
                <div className="p-6">
                    <label htmlFor="amount" className="block text-sm font-medium text-slate-700">Amount (PHP)</label>
                    <input
                        type="number"
                        id="amount"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        className="mt-1 block w-full px-3 py-2 bg-white border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-pink-500 focus:border-pink-500"
                        placeholder="0.00"
                        autoFocus
                        onKeyDown={(e) => e.key === 'Enter' && handleSave()}
                    />
                </div>
                <div className="bg-slate-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse rounded-b-lg">
                    <button onClick={handleSave} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-pink-500 text-base font-medium text-white hover:bg-pink-600 focus:outline-none sm:ml-3 sm:w-auto sm:text-sm">Pledge Amount</button>
                    <button type="button" onClick={onClose} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none sm:mt-0 sm:w-auto sm:text-sm">Cancel</button>
                </div>
            </div>
        </div>
    );
}
