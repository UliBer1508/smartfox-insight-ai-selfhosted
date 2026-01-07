import { useState, useEffect } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { z } from 'zod';

const authSchema = z.object({
  email: z.string().email('Ungültige E-Mail-Adresse'),
  password: z.string().min(6, 'Passwort muss mindestens 6 Zeichen haben'),
});

export type AuthFormData = z.infer<typeof authSchema>;

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        setLoading(false);
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const validateForm = (data: AuthFormData) => {
    const result = authSchema.safeParse(data);
    if (!result.success) {
      const firstError = result.error.errors[0];
      setError(firstError.message);
      return false;
    }
    setError(null);
    return true;
  };

  const signIn = async (email: string, password: string) => {
    if (!validateForm({ email, password })) {
      return { error: { message: 'Validierungsfehler' } };
    }
    
    setLoading(true);
    setError(null);
    
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    
    if (error) {
      const errorMessage = error.message === 'Invalid login credentials' 
        ? 'Ungültige E-Mail oder Passwort' 
        : error.message;
      setError(errorMessage);
      setLoading(false);
      return { error: { message: errorMessage } };
    }
    
    setLoading(false);
    return { error: null };
  };

  const signUp = async (email: string, password: string) => {
    if (!validateForm({ email, password })) {
      return { error: { message: 'Validierungsfehler' } };
    }
    
    setLoading(true);
    setError(null);
    
    const redirectUrl = `${window.location.origin}/`;
    
    const { error, data } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
      },
    });
    
    if (error) {
      const errorMessage = error.message === 'User already registered' 
        ? 'Diese E-Mail ist bereits registriert' 
        : error.message;
      setError(errorMessage);
      setLoading(false);
      return { error: { message: errorMessage } };
    }
    
    // Check if user already exists (signup returns user but no session)
    if (data.user && !data.session) {
      setError('Diese E-Mail ist bereits registriert');
      setLoading(false);
      return { error: { message: 'Diese E-Mail ist bereits registriert' } };
    }
    
    setLoading(false);
    return { error: null };
  };

  const signOut = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signOut();
    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };

  return {
    user,
    session,
    loading,
    error,
    signIn,
    signUp,
    signOut,
    setError,
  };
}
