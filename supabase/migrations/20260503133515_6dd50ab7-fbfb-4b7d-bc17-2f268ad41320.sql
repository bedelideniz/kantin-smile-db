-- Module-based permissions for super_admin staff users
CREATE TYPE public.app_module AS ENUM (
  'schools', 'students', 'marketers', 'splashes', 'donations',
  'payments', 'sms', 'infrastructure', 'alarms', 'staff'
);

CREATE TABLE public.super_admin_module_permissions (
  user_id UUID NOT NULL,
  module public.app_module NOT NULL,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, module)
);

ALTER TABLE public.super_admin_module_permissions ENABLE ROW LEVEL SECURITY;

-- Marker row to denote the "owner" super_admin (full access bypass).
-- The very first super_admin created manually has no row in this table; we treat
-- absence of any module rows as "full access" (legacy owner). Staff users
-- created via the panel will always get at least one module row.
-- For cleaner semantics, we add an `is_owner` flag in user_roles via a
-- dedicated function instead. Below: detect owner = the user has super_admin role
-- AND no rows in super_admin_module_permissions.

CREATE OR REPLACE FUNCTION public.has_module_permission(_user_id UUID, _module public.app_module)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    -- Must be super_admin
    EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = 'super_admin')
    AND (
      -- Owner (no module rows = full access)
      NOT EXISTS (SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = _user_id)
      OR
      -- Or has explicit module grant
      EXISTS (SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = _user_id AND module = _module)
    )
$$;

CREATE OR REPLACE FUNCTION public.get_my_modules()
RETURNS TABLE(module public.app_module)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Returns NULL row set for non-super_admins.
  -- For owner: returns ALL modules.
  -- For staff: returns only granted modules.
  WITH is_super AS (
    SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'super_admin') AS yes
  ),
  has_grants AS (
    SELECT EXISTS(SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = auth.uid()) AS yes
  )
  SELECT m::public.app_module
  FROM unnest(enum_range(NULL::public.app_module)) AS m
  WHERE (SELECT yes FROM is_super) AND NOT (SELECT yes FROM has_grants)
  UNION
  SELECT module FROM public.super_admin_module_permissions WHERE user_id = auth.uid()
$$;

-- Policies: only the owner (super_admin without grants) and the user themselves can read their grants.
CREATE POLICY "Super admin owner manages permissions (select)"
ON public.super_admin_module_permissions
FOR SELECT TO authenticated
USING (
  has_role(auth.uid(), 'super_admin')
  AND NOT EXISTS (SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = auth.uid())
);

CREATE POLICY "Users read their own module permissions"
ON public.super_admin_module_permissions
FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE POLICY "Super admin owner inserts permissions"
ON public.super_admin_module_permissions
FOR INSERT TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'super_admin')
  AND NOT EXISTS (SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = auth.uid())
);

CREATE POLICY "Super admin owner deletes permissions"
ON public.super_admin_module_permissions
FOR DELETE TO authenticated
USING (
  has_role(auth.uid(), 'super_admin')
  AND NOT EXISTS (SELECT 1 FROM public.super_admin_module_permissions WHERE user_id = auth.uid())
);