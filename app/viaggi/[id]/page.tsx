import { redirect } from "next/navigation";

export default async function ViaggioIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/viaggi/${id}/luoghi`);
}
