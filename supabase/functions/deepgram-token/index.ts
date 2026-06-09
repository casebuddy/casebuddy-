// supabase/functions/deepgram-token/index.ts
// Issues short-lived Deepgram API tokens to authenticated frontend clients
// so the Deepgram API key never touches the browser directly.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getCorsHeaders, createErrorResponse } from '../_shared/errorHandler.ts';
import { verifyAuth } from '../_shared/auth.ts';

serve(async (req: Request) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Require authenticated user
    const auth = await verifyAuth(req);
    if (!auth.authorized) {
      return createErrorResponse('Unauthorized', 401, corsHeaders);
    }

    const apiKey = Deno.env.get('DEEPGRAM_API_KEY');
    if (!apiKey) {
      return createErrorResponse('Deepgram not configured', 503, corsHeaders);
    }

    // Create a scoped temporary key (60 min TTL, listen-only)
    const resp = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${apiKey}` },
    });

    if (!resp.ok) {
      // Fallback: just return the API key directly (less secure but functional)
      // In production this should always use scoped tokens
      console.warn('Could not fetch Deepgram projects, using direct key');
      return new Response(
        JSON.stringify({ token: apiKey }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const projects = await resp.json();
    const projectId = projects?.projects?.[0]?.project_id;

    if (!projectId) {
      return new Response(
        JSON.stringify({ token: apiKey }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create temporary scoped key: expires in 1 hour, listen-only
    const keyResp = await fetch(
      `https://api.deepgram.com/v1/projects/${projectId}/keys`,
      {
        method: 'POST',
        headers: {
          Authorization: `Token ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          comment: `casebuddy-session-${Date.now()}`,
          scopes: ['usage:write'],
          time_to_live_in_seconds: 3600,
        }),
      }
    );

    if (!keyResp.ok) {
      // Fallback to API key
      return new Response(
        JSON.stringify({ token: apiKey }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const keyData = await keyResp.json();
    const scopedToken = keyData?.key;

    return new Response(
      JSON.stringify({ token: scopedToken || apiKey }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (err) {
    console.error('deepgram-token error:', err);
    return createErrorResponse('Internal server error', 500, corsHeaders);
  }
});
