import { PostingConsole } from "@/components/hiring/requisitions/PostingConsole";

export default async function PostingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostingConsole id={id} />;
}
