import { AdminDashboard } from '~/components/admin/admin-dashboard';

export default async function AdminPage(props: {
  searchParams?: Promise<{ search?: string }>;
}) {
  const searchParams = await props.searchParams;
  return (
    <div className="bg-background min-h-screen flex-grow p-5">
      <AdminDashboard searchParams={searchParams} />
    </div>
  );
}
