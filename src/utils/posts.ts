import { notFound } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'

export type PostType = {
  id: string
  title: string
  body: string
}

export const fetchPost = createServerFn({ method: 'GET' })
  .inputValidator((d: string) => d)
  .handler(async ({ data: postId }) => {
    console.info(`Fetching post with id ${postId}...`)

    const response = await fetch(
      `https://jsonplaceholder.typicode.com/posts/${postId}`,
    )

    if (response.status === 404) {
      throw notFound()
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch post ${postId}: ${response.status}`)
    }

    return (await response.json()) as PostType
  })

export const fetchPosts = createServerFn({ method: 'GET' }).handler(async () => {
  console.info('Fetching posts...')

  const response = await fetch('https://jsonplaceholder.typicode.com/posts')

  if (!response.ok) {
    throw new Error(`Failed to fetch posts: ${response.status}`)
  }

  return ((await response.json()) as Array<PostType>).slice(0, 10)
})
